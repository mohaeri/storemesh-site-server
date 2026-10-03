import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';

const key=()=>randomUUID();
function quarantined(){
  const app=new StoreMesh(),session=app.openSession('manager','TEST-DEVICE','QC','MANAGER'),container=app.createContainer({capacityKg:20},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5},key());
  batch.status='SORTED';batch.zone='SORTING';container.zone='SORTING';
  const checklist=app.createQcChecklist({code:key(),product:'T',stage:'SORTING',name:'Sorting QC',items:[{code:'OK',prompt:'Accepted'}]},key());
  app.qualityCheck({sessionId:session.id,batchId:batch.id,stage:'SORTING',checklistId:checklist.id,responses:[{itemCode:'OK',value:false}],result:'QUARANTINED',inspectorId:'manager',actorRoles:['MANAGER'],attestation:{confirmed:true,role:'MANAGER'}},key());
  return{app,session,batch,container};
}
const release=(context,input={})=>context.app.releaseQuarantine({sessionId:context.session.id,batchId:context.batch.id,reason:'Retest passed',inspectorId:'manager',actorRoles:['MANAGER'],attestation:{confirmed:true,role:'MANAGER'},...input},key());

test('quarantine release restores the original zone unchanged when destination is omitted or identical',()=>{
  for(const input of[{}, {destinationZone:'SORTING'}]){const context=quarantined(),result=release(context,input);assert.equal(result.result,'APPROVED');assert.deepEqual([context.batch.status,context.batch.zone],['SORTED','SORTING'])}
});

test('quarantine release accepts only a reasoned legitimate forward destination',()=>{
  let context=quarantined();assert.throws(()=>release(context,{destinationZone:'WASHING',reason:'   '}),error=>error.code==='RELEASE_DESTINATION_OVERRIDE_REASON_REQUIRED');
  context=quarantined();context.batch.preQuarantineStatus='WASHED';context.batch.preQuarantineZone='WASHING';assert.throws(()=>release(context,{destinationZone:'PACKAGING'}),error=>error.code==='RELEASE_DESTINATION_INVALID');
  context=quarantined();release(context,{destinationZone:'WASHING',reason:'Manager approved forward routing'});assert.deepEqual([context.batch.status,context.batch.zone],['SORTED','WASHING']);
});
