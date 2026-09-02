import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { createServer } from '../src/server.js';
import { AuthService } from '../src/auth.js';

const key=()=>randomUUID();
const entry=(app,type,id,reason)=>app.state.inventoryLedger.filter(x=>x.entityType===type&&x.entityId===id&&x.reason===reason);
const received=(app,session,weight=10)=>{const container=app.createContainer({capacityKg:50},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:weight},key());return{container,batch}};

test('receiving, identity-preserving transforms, merge, packaging and consumables write reconciled ledger rows',()=>{
  const app=new StoreMesh(),session=app.openSession('operator','TEST-DEVICE','PACKAGING','PACKAGING_OPERATOR'),a=received(app,session,10),b=received(app,session,5);
  assert.deepEqual(entry(app,'BATCH',a.batch.id,'BATCH_RECEIVED').map(x=>[x.beforeQty,x.afterQty,x.delta]),[[0,10,10]]);
  Object.assign(a.batch,{status:'SORTED',zone:'WASHING'});Object.assign(a.container,{zone:'WASHING',status:'READY_FOR_WASHING'});
  app.transform({sessionId:session.id,containerId:a.container.id,inputs:[{batchId:a.batch.id}],process:'WASH'},key());
  assert.deepEqual(entry(app,'BATCH',a.batch.id,'WASH_IDENTITY_PRESERVED').map(x=>x.delta),[0]);
  Object.assign(a.container,{zone:'SLICING',status:'WASHED'});a.batch.zone='SLICING';
  app.transform({sessionId:session.id,containerId:a.container.id,inputs:[{batchId:a.batch.id}],process:'SLICE'},key());
  assert.deepEqual(entry(app,'BATCH',a.batch.id,'SLICE_IDENTITY_PRESERVED').map(x=>x.delta),[0]);
  const mergeContainer=app.createContainer({capacityKg:20,zone:'SORTING',designatedZones:['SORTING']},key()),merged=app.transform({sessionId:session.id,process:'MERGE',containerId:mergeContainer.id,inputs:[{batchId:a.batch.id,consumeWeightKg:2},{batchId:b.batch.id,consumeWeightKg:3}],outputWeightKg:4},key());
  assert.deepEqual(entry(app,'BATCH',merged.id,'BATCH_TRANSFORMED').map(x=>[x.beforeQty,x.afterQty,x.delta]),[[0,4,4]]);
  Object.assign(merged,{status:'DRIED',zone:'PACKAGING'});app.weighForPackaging({sessionId:session.id,batchId:merged.id,weightKg:4},key());
  const pkg=app.createPackage({sessionId:session.id,type:'POUCH',level:'UNIT',items:[{batchId:merged.id,weightKg:1}],targetWeightKg:1,tolerancePercent:0},key());
  assert.deepEqual(entry(app,'PACKAGE',pkg.id,'PACKAGE_CREATED').map(x=>x.delta),[1]);
  const consumable=app.createConsumable({code:'LEDGER-C',name:'Ledger',unit:'EA',reorderThreshold:0},key());app.receiveConsumable(consumable.id,{quantity:3,source:'supplier'},key());app.run(key(),'TEST_CONSUMPTION',()=>app.consumeConsumableDirect('LEDGER-C',1,'TEST',merged.id),{sessionId:session.id});
  assert.deepEqual(app.inventoryLedger('CONSUMABLE',consumable.id).map(x=>x.delta),[3,-1]);
  assert.equal(app.inventoryLedger('BATCH',merged.id).reduce((sum,x)=>sum+x.delta,0),merged.weightKg);
});

test('sorting, fresh-net creation, internal transfer receipt and inventory adjustment are ledgered',()=>{
  const app=new StoreMesh(),session=app.openSession('operator','TEST-DEVICE','SORTING','MANAGER'),source=received(app,session,10),out=app.createContainer({capacityKg:20},key());app.moveContainer(out.id,'SORTING',session.id,key());app.moveContainer(source.container.id,'COLD_ROOM_CLEAN',session.id,key());
  const sorted=app.sortBatch({sessionId:session.id,containerId:source.container.id,batchId:source.batch.id,outputs:[{grade:'A',size:'L',weightKg:9,containerId:out.id}],lossKg:1,lossReason:'WASTE'},key()).children[0];
  assert.deepEqual(entry(app,'BATCH',sorted.id,'BATCH_SORTED').map(x=>x.delta),[9]);
  Object.assign(sorted,{destination:'FRESH_EXPORT',zone:'FRESH_EXPORT'});Object.assign(out,{zone:'FRESH_EXPORT',status:'SORTED'});session.selectedRole='MANAGER';
  const lot=app.createFreshNetLot({sessionId:session.id,batchId:sorted.id,containerId:out.id,unitWeightKg:1,count:2},key());
  assert.deepEqual(entry(app,'FRESH_NET_LOT',lot.id,'FRESH_NETS_PACKED').map(x=>x.delta),[2]);
  app.requestAndApproveInventoryAdjustment({batchId:sorted.id,deltaKg:-.1,reasonCode:'CORRECTION',reason:'verified',requestedBy:'manager'},key());
  assert.deepEqual(entry(app,'BATCH',sorted.id,'INVENTORY_ADJUSTED').map(x=>x.delta),[-.1]);

  const target=new StoreMesh({site:'DUBAI'}),targetSession=target.openSession('receiver','TEST-DEVICE'),targetContainer=target.createContainer({capacityKg:10},key()),manifest={manifestVersion:2,nonce:key(),sourceSite:'IRAN',destinationSite:'DUBAI',shipmentCode:'S-LEDGER',status:'DISPATCHED',dispatchedAt:new Date().toISOString(),packages:[{packageCode:'P-LEDGER',type:'CARTON',items:[{batchCode:'B-LEDGER',product:'T',grade:'A',size:'L',weightKg:2}]}]};manifest.signature=target.signTransferManifest(manifest);
  const transferred=target.receiveInternalTransfer({sessionId:targetSession.id,containerId:targetContainer.id,manifest,scannedPackageCodes:['P-LEDGER']},key()).batches[0];
  assert.deepEqual(entry(target,'BATCH',transferred.id,'INTERNAL_TRANSFER_RECEIVED').map(x=>x.delta),[2]);
});

test('inventory ledger persists and is protected by the FR73 trigger',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR75-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});try{let app=new StoreMesh({site,initialState:await repository.load()});app.repository=repository;const session=app.openSession('operator','TEST-DEVICE'),{batch}=received(app,session,6);await app.flush();app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:false});const rows=app.inventoryLedger('BATCH',batch.id);assert.equal(rows.length,1);assert.equal(rows[0].delta,6);await assert.rejects(repository.pool.query('UPDATE inventory_ledger SET delta=0 WHERE id=$1',[rows[0].id]),error=>error.code==='55000');await assert.rejects(repository.pool.query('DELETE FROM inventory_ledger WHERE id=$1',[rows[0].id]),error=>error.code==='55000')}finally{await repository.close()}
});

test('inventory ledger endpoint returns one entity history in occurrence order',async()=>{const app=new StoreMesh(),session=app.openSession('operator','TEST-DEVICE'),{batch}=received(app,session,4);app.requestAndApproveInventoryAdjustment({batchId:batch.id,deltaKg:-.25,reasonCode:'CORRECTION',reason:'verified',requestedBy:'manager'},key());const auth=new AuthService({secret:'ledger-secret'}),userId=randomUUID();auth.addUser({id:userId,username:'reader',password:'right',roles:['MANAGER']});const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');try{const base=`http://127.0.0.1:${server.address().port}`,login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'reader',password:'right'})}),token=(await login.json()).data.token,response=await fetch(`${base}/api/inventory/BATCH/${batch.id}/ledger`,{headers:{authorization:`Bearer ${token}`}}),payload=await response.json();assert.equal(response.status,200);assert.deepEqual(payload.items.map(x=>x.delta),[4,-.25]);assert.ok(payload.items.every(x=>x.entityId===batch.id))}finally{server.close();await once(server,'close')}});
