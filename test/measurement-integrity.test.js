import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { AuthService } from '../src/auth.js';
import { createServer } from '../src/server.js';
import { PostgresRepository } from '../src/postgres-repository.js';

test('HTTP weight-bearing operations require separately captured measurements and ignore client tolerance',async()=>{
  const app=new StoreMesh(),auth=new AuthService({secret:'measurement-http-secret'}),receiverId=randomUUID(),packerId=randomUUID();
  auth.addUser({id:receiverId,username:'receiver-weight',password:'right',roles:['RECEIVING_OPERATOR']});auth.addUser({id:packerId,username:'packer-weight',password:'right',roles:['PACKAGING_OPERATOR']});
  const scale=app.registerDevice({code:'SCALE-WEIGHT-01',type:'SCALE'},'scale'),receivingSession=app.openSession(receiverId,'TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),packagingSession=app.openSession(packerId,'PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR'),container=app.createContainer({capacityKg:20,tareWeightKg:1},'container');
  app.state.configurationVersions.push({id:randomUUID(),scope:'PACKAGING',sequence:1,status:'ACTIVE',values:{checkpointVariancePercent:100,targetWeightsByPackageType:{POUCH:1},weightTolerancePercent:2},createdAt:new Date().toISOString()});
  const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,login=async username=>(await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'right'})})).json()).data.token,post=(path,token,body)=>fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(body)});
  try{
    const receiver=await login('receiver-weight'),packer=await login('packer-weight');
    assert.equal((await post('/api/receiving',receiver,{sessionId:receivingSession.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:999})).status,400);
    assert.equal((await post('/api/measurements',receiver,{sessionId:receivingSession.id,scaleId:'missing-scale',purpose:'RECEIVING',rawReadingKg:6})).status,403);
    const captured=await post('/api/measurements',receiver,{sessionId:receivingSession.id,scaleId:scale.id,purpose:'RECEIVING',rawReadingKg:6}),measurement=(await captured.json()).data;assert.equal(captured.status,201);
    const batchResponse=await post('/api/receiving',receiver,{sessionId:receivingSession.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',measurementId:measurement.id,weightKg:999}),batchPayload=await batchResponse.json();assert.equal(batchResponse.status,201,JSON.stringify(batchPayload));const batch=batchPayload.data;assert.equal(batch.weightKg,5);app.batch(batch.id).status='DRIED';
    const checkpoint=(await(await post('/api/measurements',packer,{sessionId:packagingSession.id,scaleId:scale.id,purpose:'PACKAGING_CHECKPOINT',batchId:batch.id,rawReadingKg:5})).json()).data,checkpointResponse=await post('/api/packaging/weigh',packer,{sessionId:packagingSession.id,batchId:batch.id,measurementId:checkpoint.id,weightKg:500}),checkpointPayload=await checkpointResponse.json();assert.equal(checkpointResponse.status,201,JSON.stringify(checkpointPayload));
    const unitMeasurement=(await(await post('/api/measurements',packer,{sessionId:packagingSession.id,scaleId:scale.id,purpose:'PACKAGE_UNIT',batchId:batch.id,rawReadingKg:1.5})).json()).data,outside=await post('/api/packages',packer,{sessionId:packagingSession.id,type:'POUCH',level:'UNIT',measurementId:unitMeasurement.id,items:[{batchId:batch.id,weightKg:1}],targetWeightKg:1.5,tolerancePercent:100});assert.equal(outside.status,409);assert.equal((await outside.json()).errorCode,'PACKAGE_WEIGHT_OUT_OF_TOLERANCE');
  }finally{server.close();await once(server,'close')}
});

test('real PostgreSQL preserves immutable scale provenance through finalize and reload',{skip:!process.env.DATABASE_URL},async()=>{const site=`FR8C-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site}),app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;try{const scale=app.registerDevice({code:'SCALE-PG-01',type:'SCALE'},'scale'),session=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),container=app.createContainer({capacityKg:20,tareWeightKg:1},'container'),measurement=app.captureMeasurement({sessionId:session.id,scaleId:scale.id,purpose:'RECEIVING',rawReadingKg:8},'measurement');await app.flush();const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',measurementId:measurement.id,requireMeasurement:true},'receive');await app.flush();const restored=await repository.load(),stored=restored.measurements.find(x=>x.id===measurement.id);assert.equal(batch.weightKg,7);assert.equal(stored.scaleId,scale.id);assert.equal(stored.rawReadingKg,8);assert.equal(stored.purpose,'RECEIVING');assert.equal(stored.consumedBy,'RECEIVING');assert.ok(stored.consumedAt)}finally{await repository.close()}});
