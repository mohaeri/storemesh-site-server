import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';

const key=()=>crypto.randomUUID();
function fixture(){
  const app=new StoreMesh(),session=app.openSession('fresh','TEST-DEVICE','FRESH_EXPORT','FRESH_EXPORT_OPERATOR'),container=app.createContainer({type:'BASKET',capacityKg:20,designatedZones:['RECEIVING','FRESH_EXPORT']},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key());
  Object.assign(batch,{status:'SORTED',destination:'FRESH_EXPORT',zone:'FRESH_EXPORT'});Object.assign(container,{zone:'FRESH_EXPORT',status:'SORTED'});
  return{app,session,container,batch,input:{sessionId:session.id,batchId:batch.id,containerId:container.id,unitWeightKg:1,count:4}};
}

test('Fresh Export rejects missing, locked, foreign-session, wrongly staged and mismatched basket scans',()=>{
  let x=fixture();assert.throws(()=>x.app.createFreshNetLot({...x.input,containerId:undefined},key()),e=>e.code==='CONTAINER_SCAN_REQUIRED');
  x=fixture();x.container.locked=true;assert.throws(()=>x.app.createFreshNetLot(x.input,key()),e=>e.code==='CONTAINER_LOCKED');
  x=fixture();const other=x.app.openSession('other','TEST-DEVICE','FRESH_EXPORT','FRESH_EXPORT_OPERATOR');x.container.activeSessionId=other.id;assert.throws(()=>x.app.createFreshNetLot(x.input,key()),e=>e.code==='CONTAINER_ASSIGNED_TO_ACTIVE_SESSION');
  x=fixture();x.container.zone='SORTING';assert.throws(()=>x.app.createFreshNetLot(x.input,key()),e=>e.code==='CONTAINER_STAGE_INVALID');
  x=fixture();const empty=x.app.createContainer({type:'BASKET',capacityKg:20,zone:'FRESH_EXPORT'},key());empty.status='SORTED';assert.throws(()=>x.app.createFreshNetLot({...x.input,containerId:empty.id},key()),e=>e.code==='BATCH_CONTAINER_MISMATCH');
});

test('Fresh Export records the scanned source basket and keeps partial inventory physically linked',()=>{
  const{app,input,container,batch,session}=fixture(),lot=app.createFreshNetLot(input,key());
  assert.equal(lot.containerId,container.id);assert.equal(lot.sessionId,session.id);assert.equal(lot.deviceId,session.deviceId);assert.equal(batch.containerId,container.id);assert.deepEqual(container.batchIds,[batch.id]);assert.equal(container.activeSessionId,session.id);assert.equal(batch.weightKg,6);
});
