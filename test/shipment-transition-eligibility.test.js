import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';

const key=()=>crypto.randomUUID();
function fixture({approve=true}={}){
  const app=new StoreMesh();app.state.consumables.push({id:key(),code:'CARTON',name:'Carton',unit:'EA',quantity:10,reorderThreshold:0,status:'ACTIVE',createdAt:new Date().toISOString()});const session=app.openSession('packer','PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR'),container=app.createContainer({capacityKg:20},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key());batch.status='DRIED';app.weighForPackaging({sessionId:session.id,batchId:batch.id,weightKg:10},key());
  const unit=app.createPackage({sessionId:session.id,type:'POUCH',level:'UNIT',items:[{batchId:batch.id,weightKg:1}],targetWeightKg:1,tolerancePercent:0},key());for(const action of['PACK','SEAL','PRINT','PRINT_SUCCESS','READY'])app.transitionPackage(unit.id,action,key());
  const carton=app.createPackage({sessionId:session.id,type:'CARTON',level:'CARTON'},key());app.transitionPackage(carton.id,'PACK',key());app.scanPackageItem(carton.id,{sessionId:session.id,unitPackageCode:unit.code},key());for(const action of['SEAL','PRINT','PRINT_SUCCESS','READY'])app.transitionPackage(carton.id,action,key());
  const checklist=app.createQcChecklist({code:`SHIP-${key()}`,product:batch.product,stage:'PACKAGING',name:'Pre-shipment QC',items:[{code:'OK',prompt:'Approved for shipping'}]},key()),record=result=>app.qualityCheck({batchId:batch.id,stage:'PACKAGING',checklistId:checklist.id,responses:[{itemCode:'OK',value:result==='APPROVED'}],result,inspectorId:key(),actorRoles:['QUALITY_OPERATOR'],attestation:{confirmed:true,role:'QUALITY_OPERATOR'}},key());if(approve)record('APPROVED');
  const customer=app.createCustomer({code:`C-${key()}`,name:'Customer'},key()),order=app.createSalesOrder({customerId:customer.id,items:[{packageType:'CARTON',quantity:1}]},key());return{app,session,batch,unit,carton,order,record};
}
function assigned(x){x.shipment=x.app.createShipment({salesOrderId:x.order.id,packageIds:[x.carton.id]},key());return x}
function scanned(x){x.app.updateShipment(x.shipment.id,'START_PICKING',{},key());x.app.scanShipmentCarton(x.shipment.id,{sessionId:x.session.id,cartonCode:x.carton.code},key());return x}

test('shipment creation requires current QC approval and a genuinely completed label print',()=>{
  let x=fixture({approve:false});assert.throws(()=>x.app.createShipment({salesOrderId:x.order.id,packageIds:[x.carton.id]},key()),e=>e.code==='BATCH_QC_APPROVAL_REQUIRED');
  x=fixture();x.app.state.labels.find(l=>l.entityType==='PACKAGE'&&l.entityId===x.carton.id).status='PENDING';assert.throws(()=>x.app.createShipment({salesOrderId:x.order.id,packageIds:[x.carton.id]},key()),e=>e.code==='SHIPMENT_LABEL_NOT_PRINTED');
});

test('scan ready load and ship each revalidate the latest QC decision',()=>{
  let x=assigned(fixture());x.record('REJECTED');assert.throws(()=>x.app.scanShipmentCarton(x.shipment.id,{sessionId:x.session.id,cartonCode:x.carton.code},key()),e=>e.code==='BATCH_QC_REJECTED');
  x=scanned(assigned(fixture()));x.record('REJECTED');assert.throws(()=>x.app.updateShipment(x.shipment.id,'READY',{},key()),e=>e.code==='BATCH_QC_REJECTED');
  x=scanned(assigned(fixture()));x.app.updateShipment(x.shipment.id,'READY',{},key());x.record('REJECTED');assert.throws(()=>x.app.updateShipment(x.shipment.id,'LOAD',{vehicle:'V'},key()),e=>e.code==='BATCH_QC_REJECTED');
  x=scanned(assigned(fixture()));x.app.updateShipment(x.shipment.id,'READY',{},key());x.app.updateShipment(x.shipment.id,'LOAD',{vehicle:'V'},key());x.record('REJECTED');assert.throws(()=>x.app.updateShipment(x.shipment.id,'SHIP',{},key()),e=>e.code==='BATCH_QC_REJECTED');
});

test('status assignment lock hierarchy and blocking exceptions are revalidated after assignment',()=>{
  let x=assigned(fixture());x.carton.status='LABEL_PENDING';assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='PACKAGE_NOT_READY_TO_SHIP');
  x=assigned(fixture());x.carton.shipmentId=null;assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='SHIPMENT_ITEM_ASSIGNMENT_MISMATCH');
  x=assigned(fixture());x.carton.locked=true;assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='SHIPMENT_ITEM_LOCKED');
  x=assigned(fixture());x.app.raiseException({type:'SHIPPING_HOLD',entityType:'PACKAGE',entityId:x.carton.id,severity:'HIGH'},key());assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='SHIPMENT_BLOCKING_EXCEPTION');
  x=assigned(fixture());x.app.raiseException({type:'SHIPPING_HOLD',entityType:'PACKAGE',entityId:x.unit.id,severity:'CRITICAL'},key());assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='SHIPMENT_BLOCKING_EXCEPTION');
  x=assigned(fixture());x.unit.parentPackageId=null;assert.throws(()=>x.app.updateShipment(x.shipment.id,'START_PICKING',{},key()),e=>e.code==='SHIPMENT_CHILD_INTEGRITY_INVALID');
});

test('damaging an assigned carton atomically removes its shipment membership and scan evidence',()=>{
  const x=scanned(assigned(fixture())),shipmentId=x.shipment.id;x.app.transitionPackage(x.carton.id,'DAMAGE',key(),{reason:'forklift impact'});assert.equal(x.carton.status,'DAMAGED');assert.equal(x.carton.shipmentId,null);assert.deepEqual(x.shipment.packageIds,[]);assert.equal(x.app.state.shipmentCartonScans.some(scan=>scan.shipmentId===shipmentId&&scan.packageId===x.carton.id),false);assert.throws(()=>x.app.scanShipmentCarton(shipmentId,{sessionId:x.session.id,cartonCode:x.carton.code},key()),e=>e.code==='SHIPMENT_CARTON_UNEXPECTED');
});
