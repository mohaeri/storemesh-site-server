import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{once}from'node:events';
import{StoreMesh}from'../src/domain.js';
import{AuthService}from'../src/auth.js';
import{createServer}from'../src/server.js';
import{PostgresRepository}from'../src/postgres-repository.js';

const key=()=>randomUUID();
function fixture(app=new StoreMesh()){
  const session=app.openSession('packer','PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR');
  function carton(){
    const container=app.createContainer({capacityKg:20},key());
    const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:3},key());
    batch.status='READY_FOR_PACKAGING';
    const checklist=app.createQcChecklist({code:`SHIP-${key()}`,product:batch.product,stage:'PACKAGING',name:'Shipping QC',items:[{code:'OK',prompt:'OK'}]},key());
    app.qualityCheck({sessionId:app.state.sessions.find(x=>x.status==='ACTIVE')?.id,batchId:batch.id,stage:'PACKAGING',checklistId:checklist.id,responses:[{itemCode:'OK',value:true}],result:'APPROVED',inspectorId:key(),actorRoles:['QUALITY_OPERATOR'],attestation:{confirmed:true,role:'QUALITY_OPERATOR'}},key());
    batch.status='PACKAGED';
    const carton={id:key(),code:`C-${key()}`,type:'CARTON',level:'CARTON',status:'READY_TO_SHIP',shipmentId:null,parentPackageId:null,childPackageIds:[],items:[{batchId:batch.id,weightKg:1}],sessionId:session.id,deviceId:session.deviceId,createdAt:new Date().toISOString()};
    const label={id:key(),entityType:'PACKAGE',entityId:carton.id,identity:carton.code,payload:{},status:'PRINTED',createdAt:new Date().toISOString()};
    app.state.packages.push(carton);app.state.labels.push(label);app.state.printAttempts.push({id:key(),labelId:label.id,attemptNo:1,status:'PRINTED',sessionId:session.id,deviceId:session.deviceId,requestedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
    return carton;
  }
  const original=carton(),replacement=carton();
  const customer=app.createCustomer({code:`C-${key()}`,name:'Buyer'},key());
  const order=app.createSalesOrder({customerId:customer.id,items:[{packageType:'CARTON',quantity:1}]},key());
  const shipment=app.createShipment({salesOrderId:order.id,packageIds:[original.id]},key());
  return{app,session,original,replacement,order,shipment};
}

test('manager adds a validated replacement in DRAFT PICKING or READY and creates a pick task',()=>{
  for(const status of['DRAFT','PICKING','READY']){const f=fixture();f.app.transitionPackage(f.original.id,'DAMAGE',key(),{reason:'impact'});f.shipment.status=status;const result=f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id,replacesItemId:f.original.id},key());assert.equal(result.item.shipmentId,f.shipment.id);assert.equal(result.task.operationType,'SHIPMENT_SHIP');assert.equal(result.replacesItemId,f.original.id);assert.ok(f.app.state.audit.some(x=>x.type==='SHIPMENT_ITEM_ADDED'))}
});

test('replacement reuses eligibility and sales-order quantity validation',()=>{
  let f=fixture();f.replacement.locked=true;f.app.transitionPackage(f.original.id,'DAMAGE',key(),{reason:'impact'});assert.throws(()=>f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id},key()),e=>e.code==='SHIPMENT_ITEM_LOCKED');
  f=fixture();assert.throws(()=>f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id},key()),e=>e.code==='SALES_ORDER_QUANTITY_EXCEEDED');
});

test('replacement cannot be added after loading',()=>{for(const status of['LOADED','SHIPPED','CLOSED']){const f=fixture();f.app.transitionPackage(f.original.id,'DAMAGE',key(),{reason:'impact'});f.shipment.status=status;assert.throws(()=>f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id},key()),e=>e.code==='SHIPMENT_ITEM_ADD_INVALID')}});

test('damaged carton can be replaced and shipment completes normally',()=>{const f=fixture();f.app.transitionPackage(f.original.id,'DAMAGE',key(),{reason:'impact'});f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id,replacesItemId:f.original.id},key());f.app.updateShipment(f.shipment.id,'START_PICKING',{},key());f.app.scanShipmentCarton(f.shipment.id,{sessionId:f.session.id,itemCode:f.replacement.code},key());f.app.updateShipment(f.shipment.id,'READY',{},key());f.app.updateShipment(f.shipment.id,'LOAD',{vehicle:'TRUCK-1'},key());f.app.updateShipment(f.shipment.id,'SHIP',{},key());assert.equal(f.shipment.status,'SHIPPED');assert.equal(f.replacement.status,'SHIPPED')});

test('HTTP manager-gates assigned package and Fresh Shipping Box damage but leaves unassigned damage operator-accessible',async()=>{
  const app=new StoreMesh(),auth=new AuthService({secret:'fr51-secret'});for(const[id,role]of[['packer','PACKAGING_OPERATOR'],['exporter','FRESH_EXPORT_OPERATOR'],['manager','MANAGER']])auth.addUser({id,username:id,password:'right',roles:[role]});
  const assigned={id:key(),code:'C-ASSIGNED',type:'CARTON',level:'CARTON',status:'READY_TO_SHIP',shipmentId:key(),items:[],childPackageIds:[]},free={...assigned,id:key(),code:'C-FREE',status:'PACKING',shipmentId:null},box={id:key(),code:'FB-ASSIGNED',type:'FRESH_SHIPPING_BOX',status:'READY_TO_SHIP',shipmentId:key(),items:[]};app.state.packages.push(assigned,free);app.state.shippingBoxes.push(box);app.state.shipments.push({id:assigned.shipmentId,code:'S-P',status:'DRAFT',packageIds:[assigned.id],shippingBoxIds:[]},{id:box.shipmentId,code:'S-B',status:'DRAFT',packageIds:[],shippingBoxIds:[box.id]});
  const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');try{const base=`http://127.0.0.1:${server.address().port}`,login=async username=>(await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'right'})})).json()).data.token,post=async(path,username)=>fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${await login(username)}`,'content-type':'application/json','idempotency-key':key()},body:JSON.stringify({reason:'physical damage'})});assert.equal((await post(`/api/packages/${assigned.id}/damage`,'packer')).status,403);assert.equal((await post(`/api/packages/${assigned.id}/damage`,'manager')).status,201);assert.equal((await post(`/api/packages/${free.id}/damage`,'packer')).status,201);assert.equal((await post(`/api/fresh-shipping-boxes/${box.id}/damage`,'exporter')).status,403);assert.equal((await post(`/api/fresh-shipping-boxes/${box.id}/damage`,'manager')).status,201)}finally{server.close();await once(server,'close')}
});

test('damaged removal replacement and pick task survive PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR51-${Date.now()}`});try{const f=fixture(new StoreMesh());f.app.repository=repository;f.app.transitionPackage(f.original.id,'DAMAGE',key(),{reason:'impact'});f.app.addShipmentItem(f.shipment.id,{packageId:f.replacement.id,replacesItemId:f.original.id},key());await f.app.flush();const state=await repository.load(),shipment=state.shipments.find(x=>x.id===f.shipment.id),replacement=state.packages.find(x=>x.id===f.replacement.id),event=state.audit.find(x=>x.type==='SHIPMENT_ITEM_ADDED');assert.deepEqual(shipment.packageIds,[replacement.id]);assert.equal(replacement.shipmentId,shipment.id);assert.ok(state.tasks.some(x=>x.entityId===replacement.id&&x.operationType==='SHIPMENT_SHIP'));assert.equal(event.afterState.replacementHistory.at(-1).replacesItemId,f.original.id);assert.equal(event.afterState.replacementHistory.at(-1).itemId,replacement.id)}finally{await repository.close()}});
