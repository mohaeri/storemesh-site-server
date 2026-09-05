import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {activateTestConfiguration} from '../test-support/configurations.js';

const key=()=>randomUUID();

function receivingCycle(app,container,suffix){
  const session=app.openSession(`receiver-${suffix}`,'TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR');
  const delivery=app.startDelivery({supplierCode:'S',sessionId:session.id},key());
  app.receive({deliveryId:delivery.id,sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:2},key());
  app.completeDelivery(delivery.id,{sessionId:session.id},key());
}

function releaseContainer(app,container){
  for(const id of container.batchIds){const batch=app.state.batches.find(x=>x.id===id);if(batch)batch.containerId=null}
  container.batchIds=[];container.status='AVAILABLE';container.activeSessionId=null;
}

test('FR94 counts only BASKET receiving cycles and raises one durable supervisor warning',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR94-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    let app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    activateTestConfiguration(app,'BASKET_MAINTENANCE',{useThreshold:2});
    let basket=app.createContainer({type:'BASKET',capacityKg:20},key()),crate=app.createContainer({type:'CRATE',capacityKg:20},key());
    receivingCycle(app,basket,'basket-1');receivingCycle(app,crate,'crate-1');await app.flush();
    app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    basket=app.state.containers.find(x=>x.id===basket.id);crate=app.state.containers.find(x=>x.id===crate.id);
    assert.equal(basket.receivingUseCount,1);assert.equal(crate.receivingUseCount,0);
    releaseContainer(app,basket);releaseContainer(app,crate);
    receivingCycle(app,basket,'basket-2');receivingCycle(app,crate,'crate-2');await app.flush();
    app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    basket=app.state.containers.find(x=>x.id===basket.id);crate=app.state.containers.find(x=>x.id===crate.id);
    const warnings=app.state.exceptions.filter(x=>x.type==='BASKET_MAINTENANCE_DUE'&&x.entityId===basket.id);
    assert.equal(basket.receivingUseCount,2);assert.equal(crate.receivingUseCount,0);assert.equal(warnings.length,1);
    assert.equal(warnings[0].severity,'WARNING');assert.equal(warnings[0].supervisorOnly,true);assert.equal(basket.locked,false);
    releaseContainer(app,basket);receivingCycle(app,basket,'basket-3');await app.flush();
    const finalState=await repository.load();
    assert.equal(finalState.containers.find(x=>x.id===basket.id).receivingUseCount,3);
    assert.equal(finalState.exceptions.filter(x=>x.type==='BASKET_MAINTENANCE_DUE'&&x.entityId===basket.id).length,1);
  }finally{await repository.close()}
});
