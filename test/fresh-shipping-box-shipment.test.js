import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

let sequence=0;
const key=label=>`${label}-${++sequence}-${crypto.randomUUID()}`;

function approveForShipping(app,batch){const stage=app.batchQcStage(batch),checklist=app.createQcChecklist({code:`SHIP-${sequence}-${crypto.randomUUID()}`,product:batch.product,stage,name:'Shipping QC',items:[{code:'OK',prompt:'Approved for shipping'}]},key('checklist'));return app.qualityCheck({sessionId:app.state.sessions.find(x=>x.status==='ACTIVE')?.id,batchId:batch.id,stage,checklistId:checklist.id,responses:[{itemCode:'OK',value:true}],result:'APPROVED',notes:'Approved for shipping',inspectorId:crypto.randomUUID(),actorRoles:['QUALITY_OPERATOR'],attestation:{confirmed:true,role:'QUALITY_OPERATOR'}},key('qc'))}

function freshShipmentFixture(app){
  const session=app.openSession('fresh-operator','TEST-DEVICE','FRESH_EXPORT','FRESH_EXPORT_OPERATOR');
  const eps=app.createConsumable({code:'EPS_BOX',name:'EPS box',reorderThreshold:0},key('eps'));
  app.receiveConsumable(eps.id,{quantity:2,source:'purchase'},key('eps-stock'));
  const container=app.createContainer({capacityKg:20},key('container'));
  const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key('receive'));
  batch.status='SORTED';batch.destination='FRESH_EXPORT';batch.zone='FRESH_EXPORT';container.zone='FRESH_EXPORT';container.status='SORTED';
  const lot=app.createFreshNetLot({sessionId:session.id,batchId:batch.id,containerId:container.id,unitWeightKg:1,count:5},key('lot'));
  const box=app.createShippingBox({sessionId:session.id,allocations:[{netLotId:lot.id,count:5}]},key('box'));
  approveForShipping(app,batch);
  const print=app.state.printJobs.find(x=>x.entityType==='FRESH_SHIPPING_BOX'&&x.entityId===box.id);app.claimPrint(print.id,session.id);app.completePrint(print.id,session.id);assert.equal(box.status,'LABEL_PRINTED');app.moveToColdHolding(box.id,{sessionId:session.id,location:'EXPORT-COLD-01'},key('cold-holding'));
  const customer=app.createCustomer({code:`FRESH-${sequence}`,name:'Fresh Customer'},key('customer'));
  const order=app.createSalesOrder({customerId:customer.id,items:[{packageType:'FRESH_SHIPPING_BOX',quantity:1}]},key('order'));
  return{session,batch,box,order};
}

function shipFreshBox(app,{session,box,order}){
  const shipment=app.createShipment({salesOrderId:order.id,shippingBoxIds:[box.id]},key('shipment'));
  const task=app.state.tasks.find(x=>x.entityId===box.id&&x.operationType==='SHIPMENT_SHIP');
  assert.equal(box.shipmentId,shipment.id);
  app.updateShipment(shipment.id,'START_PICKING',{},key('picking'));
  assert.throws(()=>app.updateShipment(shipment.id,'READY',{},key('unscanned')),e=>e.code==='SHIPMENT_SCAN_INCOMPLETE');
  const scan=app.scanShipmentCarton(shipment.id,{sessionId:session.id,itemCode:box.code},key('scan'));
  assert.equal(scan.shippingBoxId,box.id);
  assert.equal(scan.itemType,'FRESH_SHIPPING_BOX');
  assert.equal(shipment.status,'PICKING');
  assert.equal(task.status,'COMPLETED');
  assert.ok(task.completedAt);
  assert.equal(task.completionNote,'Physical shipment item scan completed');
  assert.equal(task.stateHistory.at(-1).action,'AUTO_SCAN_COMPLETE');
  app.updateShipment(shipment.id,'READY',{},key('ready'));
  assert.equal(task.status,'COMPLETED');
  app.updateShipment(shipment.id,'LOAD',{vehicle:'FRESH-TRUCK-1'},key('load'));
  task.status='OPEN';task.completedAt=null;
  app.updateShipment(shipment.id,'SHIP',{},key('ship'));
  assert.equal(task.status,'COMPLETED');
  assert.equal(task.stateHistory.at(-1).action,'AUTO_SHIPMENT_SHIP');
  assert.equal(box.status,'SHIPPED');
  assert.equal(order.status,'FULFILLED');
  return{shipment,scan};
}

function unprintedBoxFixture(){const app=new StoreMesh(),session=app.openSession('fresh-operator','TEST-DEVICE','FRESH_EXPORT','FRESH_EXPORT_OPERATOR'),eps=app.createConsumable({code:'EPS_BOX',name:'EPS box',reorderThreshold:0},key('eps'));app.receiveConsumable(eps.id,{quantity:3,source:'purchase'},key('eps-stock'));const container=app.createContainer({capacityKg:20},key('container')),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key('receive'));batch.status='SORTED';batch.destination='FRESH_EXPORT';batch.zone='FRESH_EXPORT';container.zone='FRESH_EXPORT';container.status='SORTED';const lot=app.createFreshNetLot({sessionId:session.id,batchId:batch.id,containerId:container.id,unitWeightKg:1,count:6},key('lot'));return{app,session,lot}}

test('duplicate net-lot allocations are aggregated before remaining quantity validation',()=>{const{app,session,lot}=unprintedBoxFixture();assert.throws(()=>app.createShippingBox({sessionId:session.id,allocations:[{netLotId:lot.id,count:4},{netLotId:lot.id,count:3}]},key('over-allocated-box')),e=>e.code==='FRESH_NET_QUANTITY_INVALID');assert.equal(lot.remainingCount,6);const box=app.createShippingBox({sessionId:session.id,allocations:[{netLotId:lot.id,count:2},{netLotId:lot.id,count:3}]},key('aggregated-box'));assert.equal(lot.remainingCount,1);assert.deepEqual(box.items.map(x=>({netLotId:x.netLotId,count:x.count})),[{netLotId:lot.id,count:5}])});

test('Fresh Shipping Box stays label-pending after print failure then requires cold holding after successful retry',()=>{const{app,session,lot}=unprintedBoxFixture(),box=app.createShippingBox({sessionId:session.id,allocations:[{netLotId:lot.id,count:2}]},key('box')),first=app.state.printJobs.find(x=>x.entityId===box.id);assert.equal(box.status,'LABEL_PENDING');assert.throws(()=>app.moveToColdHolding(box.id,{sessionId:session.id,location:'EXPORT-COLD-01'},key('early-cold')),e=>e.code==='FRESH_SHIPPING_BOX_COLD_HOLDING_INVALID');app.claimPrint(first.id,session.id);app.failPrint(first.id,'PRINTER_ERROR',session.id);const retry=app.retryPrint(first.id,box.code,session.id,'printer recovered');app.completePrint(retry.id,session.id);assert.equal(box.status,'LABEL_PRINTED');const moved=app.moveToColdHolding(box.id,{sessionId:session.id,location:'EXPORT-COLD-01'},key('cold'));assert.equal(moved.box.status,'READY_TO_SHIP');assert.equal(box.warehouseOperatorId,session.operatorId);assert.throws(()=>app.moveToColdHolding(box.id,{sessionId:session.id,location:'EXPORT-COLD-02'},key('again')),e=>e.code==='FRESH_SHIPPING_BOX_COLD_HOLDING_INVALID')});

test('Fresh Shipping Box follows the customer shipment scan and state machine',()=>{
  const app=new StoreMesh(),fixture=freshShipmentFixture(app),{shipment}=shipFreshBox(app,fixture);
  assert.equal(shipment.status,'SHIPPED');
  assert.throws(()=>app.createShipment({salesOrderId:fixture.order.id,shippingBoxIds:[fixture.box.id]},key('reuse')),e=>['SALES_ORDER_NOT_OPEN','FRESH_SHIPPING_BOX_NOT_READY','FRESH_SHIPPING_BOX_ALREADY_ASSIGNED'].includes(e.code));
});

test('Fresh Net Lot -> Shipping Box -> Shipment -> SHIP survives a real PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const siteCode=`FR11A-${Date.now()}-${Math.floor(Math.random()*100000)}`,repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode});
  try{
    const app=new StoreMesh({site:siteCode,initialState:await repo.load(),seedDemoReferences:true});app.repository=repo;
    const fixture=freshShipmentFixture(app),{shipment,scan}=shipFreshBox(app,fixture);
    await app.flush();
    const restored=await repo.load(),savedShipment=restored.shipments.find(x=>x.id===shipment.id),savedBox=restored.shippingBoxes.find(x=>x.id===fixture.box.id),savedScan=restored.shipmentCartonScans.find(x=>x.id===scan.id);
    assert.equal(savedShipment.status,'SHIPPED');
    assert.deepEqual(savedShipment.shippingBoxIds,[fixture.box.id]);
    assert.equal(savedBox.shipmentId,shipment.id);
    assert.equal(savedBox.status,'SHIPPED');
    assert.equal(savedScan.shippingBoxId,fixture.box.id);
    assert.equal(savedScan.itemType,'FRESH_SHIPPING_BOX');
    assert.equal(restored.salesOrders.find(x=>x.id===fixture.order.id).status,'FULFILLED');
    const savedTask=restored.tasks.find(x=>x.entityId===fixture.box.id&&x.operationType==='SHIPMENT_SHIP');assert.equal(savedTask.status,'COMPLETED');assert.ok(savedTask.stateHistory.some(x=>x.action==='AUTO_SCAN_COMPLETE'));
  }finally{await repo.close()}
});
