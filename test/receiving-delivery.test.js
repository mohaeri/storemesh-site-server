import test from'node:test';
import assert from'node:assert/strict';
import{StoreMesh}from'../src/domain.js';
import{AuthService}from'../src/auth.js';

test('one delivery accepts repeated scanned baskets then creates one aggregate batch and cold-storage task',()=>{
  const app=new StoreMesh({clock:()=> '2026-06-24T10:00:00.000Z'}),session=app.openSession('receiver','TEST-DEVICE');
  app.createHarvestPeriod({code:'2026-W27',label:'هفته اول تیر',startDate:'2026-06-22',endDate:'2026-06-28'},'period');
  const delivery=app.startDelivery({supplierCode:'S',sessionId:session.id},'delivery'),containers=[app.createContainer({capacityKg:20},'c1'),app.createContainer({capacityKg:20},'c2')];
  const baskets=containers.map((container,i)=>app.receive({deliveryId:delivery.id,sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5+i},`receive-${i}`));
  assert.deepEqual(baskets.map(x=>x.harvestPeriod),['2026-W26','2026-W26']);
  assert.equal(app.state.printJobs.filter(x=>x.entityType==='BATCH').length,0);
  const completed=app.completeDelivery(delivery.id,{sessionId:session.id},'complete');
  assert.equal(completed.baskets.length,2);assert.equal(completed.receivingBatch.weightKg,11);assert.equal(completed.receivingBatch.isAggregate,true);assert.deepEqual(completed.receivingBatch.parentIds,baskets.map(x=>x.id));assert.equal(completed.task.zone,'COLD_ROOM_DIRTY');assert.equal(completed.task.entityId,completed.receivingBatch.id);assert.deepEqual(completed.delivery.containerIds,containers.map(x=>x.id));
  assert.throws(()=>app.completeDelivery(delivery.id,{sessionId:session.id},'again'),e=>e.code==='DELIVERY_NOT_OPEN');
});

test('harvest period is computed from the calendar week and client-supplied values are ignored',()=>{const app=new StoreMesh({clock:()=> '2026-06-24T10:00:00.000Z'}),session=app.openSession('receiver','TEST-DEVICE'),container=app.createContainer({capacityKg:20},'container');app.createHarvestPeriod({code:'REAL',label:'Legacy configured',startDate:'2026-06-01',endDate:'2026-06-30'},'period');const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:5,harvestPeriod:'FAKE-CLIENT'},'receive');assert.equal(batch.harvestPeriod,'2026-W26')});
test('harvest period dates are editable but active ranges cannot overlap',()=>{const app=new StoreMesh(),first=app.createHarvestPeriod({code:'H1',label:'First',startDate:'2026-01-01',endDate:'2026-01-31'},'h1'),second=app.createHarvestPeriod({code:'H2',label:'Second',startDate:'2026-02-01',endDate:'2026-02-28'},'h2');const updated=app.updateHarvestPeriod(first.id,{label:'Updated',startDate:'2026-01-05',endDate:'2026-01-25'},'edit');assert.equal(updated.label,'Updated');assert.equal(updated.startDate,'2026-01-05');assert.throws(()=>app.updateHarvestPeriod(second.id,{startDate:'2026-01-20'},'overlap'),e=>e.code==='HARVEST_PERIOD_OVERLAP')});

test('badge login requires the current independently hashed PIN',async()=>{const auth=new AuthService({secret:'badge-test',site:'IRAN'});auth.addUser({id:'operator-id',username:'operator',password:'password',roles:['RECEIVING_OPERATOR']});const first=auth.assignBadge('operator-id'),pin1=auth.assignPin('operator-id');assert.equal(auth.loginBadge(first.badgeCode,null,'TEST-DEVICE'),null);assert.equal(auth.loginBadge(first.badgeCode,'wrong','TEST-DEVICE'),null);const token=auth.loginBadge(first.badgeCode,pin1.pin,'TEST-DEVICE');assert.ok(token);assert.deepEqual(auth.verify(token).roles,['RECEIVING_OPERATOR']);const pin2=auth.assignPin('operator-id');assert.equal(auth.loginBadge(first.badgeCode,pin1.pin,'TEST-DEVICE'),null);assert.ok(auth.loginBadge(first.badgeCode,pin2.pin,'TEST-DEVICE'));const second=auth.assignBadge('operator-id');assert.equal(auth.loginBadge(first.badgeCode,pin2.pin,'TEST-DEVICE'),null);assert.ok(auth.loginBadge(second.badgeCode,pin2.pin,'TEST-DEVICE'));assert.equal(auth.publicUsers()[0].pinAssigned,true);assert.equal('badgePinHash'in auth.publicUsers()[0],false);await auth.flush()});
