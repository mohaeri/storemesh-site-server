import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();

function dispatchedShipment(app){
  const session=app.openSession('origin-shipper','TEST-DEVICE','SHIPPING','SHIPPING_OPERATOR');
  const container=app.createContainer({capacityKg:20},key());
  const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:8},key());
  const pkg=app.createPackage({sessionId:session.id,type:'POUCH',items:[{batchId:batch.id,weightKg:2}]},key());
  for(const action of ['PACK','SEAL','PRINT','PRINT_SUCCESS','READY'])app.transitionPackage(pkg.id,action,key());
  app.state.qualityChecks.push({id:key(),batchId:batch.id,result:'APPROVED',notes:'',createdAt:app.clock()});
  const shipment=app.createInternalShipment({destinationSite:'DUBAI',packageIds:[pkg.id]},key());
  app.updateInternalShipment(shipment.id,'LOAD',{sessionId:session.id,vehicle:'TRUCK-96'},key());
  app.updateInternalShipment(shipment.id,'DISPATCH',{sessionId:session.id,scannedPackageCodes:[pkg.code]},key());
  return{session,batch,pkg,shipment};
}

test('destination receipt acknowledgment is required and delivers the matching origin shipment',{skip:!process.env.DATABASE_URL},async()=>{
  const suffix=Date.now(),originRepository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR96-ORIGIN-${suffix}`}),destinationRepository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR96-DEST-${suffix}`});
  try{
    const origin=new StoreMesh({site:'IRAN',initialState:await originRepository.load(),seedDemoReferences:true});origin.repository=originRepository;
    const destination=new StoreMesh({site:'DUBAI',initialState:await destinationRepository.load(),seedDemoReferences:true});destination.repository=destinationRepository;
    const{shipment,pkg}=dispatchedShipment(origin),manifest=origin.shipmentManifest(shipment.id);
    assert.throws(()=>origin.updateInternalShipment(shipment.id,'DELIVER',{},key()),error=>error.code==='TRANSFER_RECEIPT_REQUIRED');
    assert.equal(shipment.status,'DISPATCHED');
    const destinationSession=destination.openSession('destination-receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),target=destination.createContainer({capacityKg:20},key());
    const receipt=destination.receiveInternalTransfer({sessionId:destinationSession.id,containerId:target.id,manifest,scannedPackageCodes:[pkg.code]},key());
    const delivered=origin.updateInternalShipment(shipment.id,'DELIVER',{deliveryAcknowledgment:receipt.deliveryAcknowledgment},key());
    assert.equal(delivered.status,'DELIVERED');
    assert.equal(delivered.deliveryReceiptId,receipt.transfer.id);
    assert.equal(delivered.deliveredBy,'destination-receiver');
    await Promise.all([origin.flush(),destination.flush()]);
    const [originState,destinationState]=await Promise.all([originRepository.load(),destinationRepository.load()]);
    assert.equal(originState.shipments.find(x=>x.id===shipment.id).status,'DELIVERED');
    assert.equal(destinationState.internalTransfers.find(x=>x.shipmentCode===shipment.code).deliveryAcknowledgment.signature,receipt.deliveryAcknowledgment.signature);
  }finally{await Promise.all([originRepository.close(),destinationRepository.close()])}
});

test('unreceived dispatched shipment stays DISPATCHED and raises one operator-visible timeout exception',{skip:!process.env.DATABASE_URL},async()=>{
  let now=Date.parse('2026-01-01T00:00:00.000Z');
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR96-TIMEOUT-${Date.now()}`});
  try{
    const app=new StoreMesh({site:'IRAN',clock:()=>new Date(now).toISOString(),initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    const{shipment}=dispatchedShipment(app);
    now+=259200001;
    assert.equal(app.sweepInternalTransferReceipts(),1);
    assert.equal(app.sweepInternalTransferReceipts(),0);
    assert.equal(shipment.status,'DISPATCHED');
    const warning=app.state.exceptions.find(x=>x.type==='INTERNAL_TRANSFER_RECEIPT_OVERDUE'&&x.entityId===shipment.id);
    assert.deepEqual([warning.entityType,warning.severity,warning.status],['SHIPMENT','HIGH','OPEN']);
    await app.flush();
    const restored=await repository.load();
    assert.equal(restored.shipments.find(x=>x.id===shipment.id).status,'DISPATCHED');
    assert.equal(restored.exceptions.filter(x=>x.type==='INTERNAL_TRANSFER_RECEIPT_OVERDUE'&&x.entityId===shipment.id).length,1);
  }finally{await repository.close()}
});
