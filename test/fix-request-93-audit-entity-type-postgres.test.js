import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConfiguredStoreMesh as StoreMesh} from '../test-support/configurations.js';
import {PostgresRepository} from '../src/postgres-repository.js';

const key=()=>randomUUID();

test('FR93 persists audit and outbox entity types for distinct business objects',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR93-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});
    app.repository=repository;
    const session=app.openSession('packager','TEST-DEVICE','PACKAGING','PACKAGING_OPERATOR');
    const container=app.createContainer({capacityKg:20},key());
    const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5},key());
    const pkg=app.createPackage({sessionId:session.id,type:'POUCH',items:[{batchId:batch.id,weightKg:1}]},key());
    const customer=app.createCustomer({code:`C-${Date.now()}`,name:'Audit customer'},key());
    await app.flush();
    const restored=await repository.load();
    const expected=[['CONTAINER_CREATED',container.id,'CONTAINER'],['PACKAGE_CREATED',pkg.id,'PACKAGE'],['CUSTOMER_CREATED',customer.id,'CUSTOMER']];
    for(const[type,entityId,entityType]of expected){
      const audit=restored.audit.find(x=>x.type===type&&x.entityId===entityId);
      assert.equal(audit?.entityType,entityType);
      const outbox=restored.outbox.find(x=>x.type===type&&x.entityId===entityId);
      assert.equal(outbox?.entityType,entityType);
    }
  }finally{await repository.close()}
});
