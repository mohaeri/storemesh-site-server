import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {activateTestConfiguration} from '../test-support/configurations.js';

const key=()=>randomUUID();

function source(app){
  const session=app.openSession('fresh','TEST-DEVICE','FRESH_EXPORT','FRESH_EXPORT_OPERATOR');
  const container=app.createContainer({capacityKg:20},key());
  const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key());
  Object.assign(batch,{status:'SORTED',destination:'FRESH_EXPORT',zone:'FRESH_EXPORT'});
  Object.assign(container,{zone:'FRESH_EXPORT',status:'SORTED',activeSessionId:null});
  return{session,container,batch,input:{sessionId:session.id,batchId:batch.id,containerId:container.id,count:2}};
}

test('FR92 requires server-configured fresh net weights and persists configured behavior',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR92-${Date.now()}`;
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});
    app.repository=repository;
    const first=source(app);
    assert.throws(()=>app.createFreshNetLot({...first.input,unitWeightKg:3,allowedWeightsKg:[3]},key()),error=>error.code==='FRESH_EXPORT_NET_WEIGHTS_NOT_CONFIGURED'&&error.status===409);
    assert.equal(first.batch.weightKg,10);
    assert.equal(first.container.activeSessionId,null);
    activateTestConfiguration(app,'FRESH_EXPORT',{allowedNetWeightsKg:[1]});
    assert.throws(()=>app.createFreshNetLot({...first.input,unitWeightKg:3,allowedWeightsKg:[3]},key()),error=>error.code==='FRESH_NET_CONFIGURATION_INVALID');
    const lot=app.createFreshNetLot({...first.input,unitWeightKg:1,allowedWeightsKg:[3]},key());
    await app.flush();
    const restored=await repository.load();
    assert.equal(restored.freshNetLots.find(x=>x.id===lot.id)?.unitWeightKg,1);
    assert.deepEqual(restored.configurationVersions.find(x=>x.scope==='FRESH_EXPORT'&&x.status==='ACTIVE')?.values.allowedNetWeightsKg,[1]);
  }finally{await repository.close()}
});
