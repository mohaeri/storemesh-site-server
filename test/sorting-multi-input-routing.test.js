import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();
const pgOnly={skip:!process.env.DATABASE_URL};

function fixture(app=new StoreMesh()){
  const session=app.openSession('sorting-expert','TEST-DEVICE','SORTING','SORTING_OPERATOR');
  const receive=(supplier,weightKg)=>{const container=app.createContainer({capacityKg:30},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier,product:'T',grade:'UNSORTED',size:'MIXED',weightKg},key());app.moveContainer(container.id,'COLD_ROOM_CLEAN',session.id,key());return{container,batch}};
  const output=()=>{const container=app.createContainer({capacityKg:30},key());app.moveContainer(container.id,'SORTING',session.id,key());return container};
  return{app,session,receive,output};
}

test('sorting expert scans multiple baskets and assigns each weighed output route without manager approval',()=>{
  const{app,session,receive,output}=fixture(),a=receive('S',6),b=receive('S1',4),fresh=output(),dry=output();
  const result=app.sortBatch({sessionId:session.id,inputs:[{batchId:a.batch.id,containerId:a.container.id},{batchId:b.batch.id,containerId:b.container.id}],outputs:[{grade:'A',size:'L',weightKg:5,containerId:fresh.id,destination:'FRESH_EXPORT',parentContributions:[{batchId:a.batch.id,inputWeightKg:3},{batchId:b.batch.id,inputWeightKg:2}]},{grade:'B',size:'S',weightKg:4,containerId:dry.id,destination:'DRYING',parentContributions:[{batchId:a.batch.id,inputWeightKg:2},{batchId:b.batch.id,inputWeightKg:2}]}],lossReason:'RESIDUAL_MATERIAL'},key());
  assert.deepEqual(result.counters,{basketsProcessed:2,batchesCreated:2});
  assert.deepEqual(result.children.map(x=>x.destination),['FRESH_EXPORT','DRYING']);
  assert.deepEqual(result.children[0].parentIds,[a.batch.id,b.batch.id]);
  assert.deepEqual(result.children[0].parentContributions,[{batchId:a.batch.id,inputWeightKg:3},{batchId:b.batch.id,inputWeightKg:2}]);
  assert.deepEqual(result.children[0].suppliers.sort(),['S','S1']);
  assert.equal(app.state.tasks.filter(x=>x.requiredRole==='MANAGER').length,0);
  assert.equal(app.state.tasks.find(x=>x.entityId===result.children[0].id)?.zone,'FRESH_EXPORT');
  assert.equal(app.state.tasks.find(x=>x.entityId===result.children[1].id)?.zone,'WASHING');
  assert.ok([a.container,b.container].every(x=>x.status==='AVAILABLE'&&x.batchIds.length===0));
});

test('multi-input sorting rejects ambiguous genealogy and washing rejects a fresh route',()=>{
  const{app,session,receive,output}=fixture(),a=receive('S',6),b=receive('S1',4),target=output();
  assert.throws(()=>app.sortBatch({sessionId:session.id,inputs:[{batchId:a.batch.id,containerId:a.container.id},{batchId:b.batch.id,containerId:b.container.id}],outputs:[{grade:'A',size:'L',weightKg:9,containerId:target.id,destination:'FRESH_EXPORT'}],lossReason:'RESIDUAL_MATERIAL'},key()),error=>error.code==='SORT_PARENT_CONTRIBUTIONS_INVALID');
  const freshBatch={...a.batch,status:'SORTED',destination:'FRESH_EXPORT'};Object.assign(a.batch,freshBatch);app.moveContainer(a.container.id,'WASHING',session.id,key());
  assert.throws(()=>app.transform({sessionId:session.id,containerId:a.container.id,inputs:[{batchId:a.batch.id}],process:'WASH'},key()),error=>error.code==='BATCH_ROUTE_DOES_NOT_REQUIRE_WASH');
});

test('multi-parent route and exact genealogy survive real PostgreSQL reload',pgOnly,async()=>{
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`SORT-MULTI-${Date.now()}`});
  try{const app=new StoreMesh({site:repository.siteCode,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;const{session,receive,output}=fixture(app),a=receive('S',6),b=receive('S1',4),target=output(),result=app.sortBatch({sessionId:session.id,inputs:[{batchId:a.batch.id,containerId:a.container.id},{batchId:b.batch.id,containerId:b.container.id}],outputs:[{grade:'A',size:'L',weightKg:9,containerId:target.id,destination:'FREEZE_DRYING',parentContributions:[{batchId:a.batch.id,inputWeightKg:5},{batchId:b.batch.id,inputWeightKg:4}]}],lossReason:'RESIDUAL_MATERIAL'},key());await app.flush();const restored=await repository.load(),child=restored.batches.find(x=>x.id===result.children[0].id);assert.equal(child.destination,'FREEZE_DRYING');assert.deepEqual(Object.fromEntries(child.parentContributions.map(x=>[x.batchId,x.inputWeightKg])),{[a.batch.id]:5,[b.batch.id]:4});assert.deepEqual(child.suppliers.sort(),['S','S1']);assert.equal(restored.tasks.find(x=>x.entityId===child.id&&x.status==='OPEN')?.zone,'WASHING')}finally{await repository.close()}
});
