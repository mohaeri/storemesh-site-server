import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh, AUDIT_CATEGORIES, auditCategoryFor } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { guardedHistoryCleanup } from '../support/postgres-cleanup.js';

test('audit categories cover the specification and representative event types',()=>{
  assert.deepEqual(AUDIT_CATEGORIES,['Authentication','Inventory','Production','Packaging','Shipping','Labeling','Exceptions','Configuration','Administration','Security']);
  const expected={LOGIN_SUCCEEDED:'Authentication',BATCH_RECEIVED:'Inventory',CYCLE_STARTED:'Production',PACKAGE_CREATED:'Packaging',SHIPMENT_CREATED:'Shipping',LABEL_PRINTED:'Labeling',EXCEPTION_RAISED:'Exceptions',REQUEST_VALIDATION_FAILED:'Exceptions',RESOURCE_NOT_FOUND:'Exceptions',SYSTEM_FAILURE:'Exceptions',CONFIGURATION_ACTIVATED:'Configuration',ROLE_CREATED:'Administration',PERMISSION_DENIED:'Security'};
  for(const[type,category]of Object.entries(expected))assert.equal(auditCategoryFor(type),category,type);
  const app=new StoreMesh();
  for(const type of Object.keys(expected))app.record(type,null,{});
  assert.ok(app.state.audit.every(event=>event.category&&AUDIT_CATEGORIES.includes(event.category)));
});

test('audit category survives PostgreSQL reload and guarded archive restore',{skip:!process.env.DATABASE_URL},async()=>{
  const siteCode=`FR99-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode});
  try{
    const app=new StoreMesh({site:siteCode,initialState:await repository.load(),seedDemoReferences:false,clock:()=> '2020-01-01T00:00:00.000Z'});app.repository=repository;
    const event=app.record('PACKAGE_CREATED',null,{marker:'fr99'});app.persist();await app.flush();
    const restored=await repository.load(),loaded=restored.audit.find(item=>item.id===event.id);
    assert.equal(loaded.category,'Packaging');
    assert.ok(restored.audit.every(item=>item.category!==null));
    await repository.pool.query("UPDATE outbox_events SET status='DELIVERED',delivered_at=now() WHERE id=$1",[event.id]);
    assert.deepEqual(await repository.archiveHistory({auditRetentionDays:1,outboxRetentionDays:1}),{audit:1,outbox:1});
    const archived=(await repository.archivedAuditEvents()).find(item=>item.id===event.id);
    assert.equal(archived.category,'Packaging');
  }finally{
    await guardedHistoryCleanup(repository.pool,repository.siteId);
    for(const table of['outbox_events','audit_events','site_state_versions'])await repository.pool.query(`DELETE FROM ${table} WHERE site_id=$1`,[repository.siteId]).catch(()=>{});
    await repository.pool.query('DELETE FROM sites WHERE id=$1',[repository.siteId]).catch(()=>{});
    await repository.close();
  }
});
