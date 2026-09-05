import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const activate=(app,scope,values)=>{const version=app.createConfiguration({scope,values,userId:'author'},randomUUID());app.transitionConfiguration(version.id,'APPROVE','reviewer',randomUUID());app.transitionConfiguration(version.id,'ACTIVATE','reviewer',randomUUID());return version};

test('task priority and receiving variance are configuration-backed in real PostgreSQL',{skip:!process.env.DATABASE_URL},async()=>{
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR116-${Date.now()}`});
  try{
    const app=new StoreMesh({site:repository.siteCode,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    activate(app,'TASK_PRIORITIES',{manualDefault:41,shippingPick:42,automatic:43,shippingHigh:44,qcCorrective:45,shippingUrgent:46});
    const receiving=activate(app,'RECEIVING',{weightVarianceLimit:.1});
    const session=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),container=app.createContainer({capacityKg:100},randomUUID());
    const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:80,expectedWeightKg:100,weightVarianceLimit:.9},randomUUID());
    assert.equal(app.state.tasks.find(task=>task.entityId===container.id)?.priority,43);
    assert.equal(batch.configVersionId,receiving.id);
    assert.ok(app.state.exceptions.some(exception=>exception.type==='WEIGHT_ANOMALY'&&exception.entityId===batch.id));
    activate(app,'TASK_PRIORITIES',{manualDefault:51,shippingPick:52,automatic:53,shippingHigh:54,qcCorrective:55,shippingUrgent:56});
    const nextContainer=app.createContainer({capacityKg:100},randomUUID());
    app.receive({sessionId:session.id,containerId:nextContainer.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},randomUUID());
    assert.equal(app.state.tasks.find(task=>task.entityId===nextContainer.id)?.priority,53);
    await app.flush();
    const restored=await repository.load();
    assert.equal(restored.tasks.find(task=>task.entityId===container.id)?.priority,43);
    assert.equal(restored.tasks.find(task=>task.entityId===nextContainer.id)?.priority,53);
    assert.ok(restored.exceptions.some(exception=>exception.type==='WEIGHT_ANOMALY'&&exception.entityId===batch.id));
  }finally{await repository.close()}
});
