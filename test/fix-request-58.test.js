import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';

const key=()=>randomUUID();
function fixture(app=new StoreMesh()){
  const session=app.openSession('loader','TEST-DEVICE','SHIPPING','SHIPPING_OPERATOR'),container=app.createContainer({capacityKg:20},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:8},key()),pkg=app.createPackage({sessionId:session.id,type:'POUCH',items:[{batchId:batch.id,weightKg:2}]},key());
  for(const action of['PACK','SEAL','PRINT','PRINT_SUCCESS','READY'])app.transitionPackage(pkg.id,action,key());
  app.state.qualityChecks.push({id:key(),batchId:batch.id,result:'APPROVED',notes:'',createdAt:new Date().toISOString()});
  const shipment=app.createInternalShipment({destinationSite:'DUBAI',packageIds:[pkg.id]},key());
  return{app,session,pkg,shipment};
}

test('internal shipment cancellation requires reason and records actor evidence while releasing packages',()=>{
  const{app,session,pkg,shipment}=fixture();
  assert.throws(()=>app.updateInternalShipment(shipment.id,'CANCEL',{sessionId:session.id},key()),error=>error.code==='INTERNAL_SHIPMENT_CANCEL_REASON_REQUIRED');
  const cancelled=app.updateInternalShipment(shipment.id,'CANCEL',{sessionId:session.id,reason:'  Route withdrawn  '},key());
  assert.equal(cancelled.cancellationReason,'Route withdrawn');
  assert.deepEqual([cancelled.cancelledBy,cancelled.cancelledSessionId,cancelled.cancelledDeviceId],['loader',session.id,'TEST-DEVICE']);
  assert.equal(pkg.shipmentId,null);
});

test('internal shipment cancellation evidence survives real PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR58-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const context=fixture(new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true}));context.app.repository=repository;
    context.app.updateInternalShipment(context.shipment.id,'CANCEL',{sessionId:context.session.id,reason:'Carrier unavailable'},key());
    await context.app.flush();
    const restored=await repository.load(),shipment=restored.shipments.find(x=>x.id===context.shipment.id),pkg=restored.packages.find(x=>x.id===context.pkg.id);
    assert.deepEqual([shipment.cancellationReason,shipment.cancelledBy,shipment.cancelledSessionId,shipment.cancelledDeviceId],['Carrier unavailable','loader',context.session.id,'TEST-DEVICE']);
    assert.equal(pkg.shipmentId,null);
  }finally{await repository.close()}
});
