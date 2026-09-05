import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {activateTestConfiguration} from '../test-support/configurations.js';

const key=()=>randomUUID();

test('FR95 requires per-UNIT scale evidence and uses measured weight',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR95-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    activateTestConfiguration(app,'PACKAGING',{targetWeightKg:1,weightTolerancePercent:0,requireScaleEvidence:false});
    const session=app.openSession('packer','TEST-DEVICE','PACKAGING','PACKAGING_OPERATOR');
    const container=app.createContainer({capacityKg:20},key());
    const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5},key());
    Object.assign(batch,{status:'DRIED',zone:'PACKAGING'});
    app.weighForPackaging({sessionId:session.id,batchId:batch.id,weightKg:5},key());
    assert.throws(()=>app.createPackage({sessionId:session.id,type:'POUCH',level:'UNIT',items:[{batchId:batch.id,weightKg:1}]},key()),error=>error.code==='PACKAGE_MEASUREMENT_REQUIRED'&&error.status===409);
    const scale=app.registerDevice({code:'FR95-SCALE',type:'SCALE',assignedStation:'PACKAGING'},key());
    const measurement=app.captureMeasurement({sessionId:session.id,scaleId:scale.id,batchId:batch.id,purpose:'PACKAGE_UNIT',rawReadingKg:1},key());
    const unit=app.createPackage({sessionId:session.id,type:'POUCH',level:'UNIT',measurementId:measurement.id,items:[{batchId:batch.id,weightKg:3}]},key());
    assert.equal(unit.measuredWeightKg,1);assert.equal(unit.items[0].weightKg,1);assert.equal(batch.weightKg,4);
    assert.equal(measurement.consumedBy,'PACKAGE_UNIT');
    await app.flush();
    const restored=await repository.load(),saved=restored.packages.find(x=>x.id===unit.id);
    assert.equal(saved.measuredWeightKg,1);assert.equal(saved.items[0].weightKg,1);
  }finally{await repository.close()}
});
