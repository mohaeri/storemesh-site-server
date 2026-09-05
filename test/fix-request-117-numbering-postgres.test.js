import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();
const activate=(app,scope,values)=>{const version=app.createConfiguration({scope,values,userId:'author'},key());app.transitionConfiguration(version.id,'APPROVE','reviewer',key());app.transitionConfiguration(version.id,'ACTIVATE','reviewer',key());return version};
const receive=(app,session)=>{const container=app.createContainer({capacityKg:30},key());return app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key())};

test('numbering defaults, activation, and non-retroactivity persist in real PostgreSQL',{skip:!process.env.DATABASE_URL},async()=>{
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR117-${Date.now()}`});
  try{
    const app=new StoreMesh({site:repository.siteCode,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    const receiving=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR');
    const originalTask=app.createTask({title:'Original',zone:'QC'},key()),originalBatch=receive(app,receiving);
    assert.match(originalTask.code,new RegExp(`^T-${repository.siteCode}-\\d{6}$`));
    assert.match(originalBatch.code,new RegExp(`^B-${repository.siteCode}-\\d{6}$`));
    activate(app,'NUMBERING',{taskPrefix:'WORK',batchPrefix:'LOT',packagePrefix:'PACK',separator:'/',sequenceWidth:4});
    const configuredTask=app.createTask({title:'Configured',zone:'QC'},key()),configuredBatch=receive(app,receiving);
    assert.equal(configuredTask.code,`WORK/${repository.siteCode}/0003`);
    assert.equal(configuredBatch.code,`LOT/${repository.siteCode}/0002`);
    activate(app,'PACKAGING',{targetWeightKg:1,weightTolerancePercent:2});
    const scale=app.registerDevice({code:`SCALE-${Date.now()}`,type:'SCALE',assignedStation:'PACKAGING'},key()),packaging=app.openSession('packer','PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR');
    configuredBatch.status='DRIED';app.weighForPackaging({sessionId:packaging.id,batchId:configuredBatch.id,weightKg:10},key());
    const measurement=app.captureMeasurement({sessionId:packaging.id,scaleId:scale.id,batchId:configuredBatch.id,purpose:'PACKAGE_UNIT',rawReadingKg:1},key());
    const pkg=app.createPackage({sessionId:packaging.id,type:'POUCH',level:'UNIT',items:[{batchId:configuredBatch.id,weightKg:1}],measurementId:measurement.id},key());
    assert.equal(pkg.code,`PACK/${repository.siteCode}/0001`);
    assert.match(originalTask.code,new RegExp(`^T-${repository.siteCode}-`));
    assert.match(originalBatch.code,new RegExp(`^B-${repository.siteCode}-`));
    await app.flush();
    const restored=await repository.load();
    assert.equal(restored.tasks.find(item=>item.id===configuredTask.id).code,configuredTask.code);
    assert.equal(restored.batches.find(item=>item.id===originalBatch.id).code,originalBatch.code);
    assert.equal(restored.packages.find(item=>item.id===pkg.id).code,pkg.code);
  }finally{await repository.close()}
});
