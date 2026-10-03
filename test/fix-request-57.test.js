import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';

const key=()=>randomUUID();
const attestation={confirmed:true,role:'QUALITY_OPERATOR'};

function fixture(app=new StoreMesh()){
  const session=app.openSession('quality-user','TEST-DEVICE','QC','QUALITY_OPERATOR');
  const container=app.createContainer({capacityKg:20},key());
  const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5},key());
  const checklist=app.createQcChecklist({code:`QC-${key()}`,product:'T',stage:'RECEIVING',name:'Receiving QC',items:[{code:'OK',prompt:'Accepted'}]},key());
  return{app,session,batch,checklist};
}

test('QC checklist validates product reference and fixed stage vocabulary',()=>{
  const app=new StoreMesh(),base={code:key(),name:'QC',items:[{code:'OK',prompt:'Accepted'}]};
  assert.throws(()=>app.createQcChecklist({...base,product:'UNKNOWN',stage:'RECEIVING'},key()),error=>error.code==='MASTER_DATA_REFERENCE_INVALID');
  assert.throws(()=>app.createQcChecklist({...base,code:key(),product:'T',stage:'SHIPPING'},key()),error=>error.code==='QC_CHECKLIST_STAGE_INVALID');
  assert.equal(app.createQcChecklist({...base,code:key(),product:'T',stage:'PACKAGING'},key()).stage,'PACKAGING');
});

test('quality decision and quarantine release require and retain session evidence',()=>{
  const context=fixture(),request={batchId:context.batch.id,stage:'RECEIVING',checklistId:context.checklist.id,responses:[{itemCode:'OK',value:false}],result:'QUARANTINED',inspectorId:'quality-user',actorRoles:['QUALITY_OPERATOR'],attestation};
  assert.throws(()=>context.app.qualityCheck(request,key()),error=>error.code==='SESSION_NOT_FOUND');
  const quarantine=context.app.qualityCheck({...request,sessionId:context.session.id},key());
  assert.deepEqual([quarantine.sessionId,quarantine.deviceId],[context.session.id,'TEST-DEVICE']);
  const releaseBase={batchId:context.batch.id,reason:'Retest passed',inspectorId:'quality-user',actorRoles:['QUALITY_OPERATOR'],attestation};
  assert.throws(()=>context.app.releaseQuarantine(releaseBase,key()),error=>error.code==='SESSION_NOT_FOUND');
  const release=context.app.releaseQuarantine({...releaseBase,sessionId:context.session.id},key());
  assert.deepEqual([release.sessionId,release.deviceId],[context.session.id,'TEST-DEVICE']);
});

test('QC session and device evidence survive real PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR57-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const context=fixture(new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true}));context.app.repository=repository;
    const check=context.app.qualityCheck({batchId:context.batch.id,stage:'RECEIVING',checklistId:context.checklist.id,responses:[{itemCode:'OK',value:false}],result:'QUARANTINED',sessionId:context.session.id,inspectorId:'quality-user',actorRoles:['QUALITY_OPERATOR'],attestation},key());
    const release=context.app.releaseQuarantine({batchId:context.batch.id,reason:'Retest passed',sessionId:context.session.id,inspectorId:'quality-user',actorRoles:['QUALITY_OPERATOR'],attestation},key());
    await context.app.flush();
    const restored=await repository.load();
    for(const id of[check.id,release.id]){const record=restored.qualityChecks.find(x=>x.id===id);assert.deepEqual([record.sessionId,record.deviceId],[context.session.id,'TEST-DEVICE'])}
  }finally{await repository.close()}
});
