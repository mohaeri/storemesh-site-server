import test from 'node:test';import assert from 'node:assert/strict';import { PostgresRepository } from '../src/postgres-repository.js';
import { randomUUID } from 'node:crypto';

test('postgres repository stores idempotency metadata and advances an atomic site version',async()=>{
  const calls=[];const query=async(sql,args)=>{calls.push({sql,args});return{rows:/SELECT version/.test(sql)?[{version:0}]:[]}};
  const repo=Object.create(PostgresRepository.prototype);Object.assign(repo,{siteCode:'IRAN',siteId:'d804be5e-1c77-4a9c-a456-b98a51497bea',version:0,hashes:new Map(),pool:{query}});
  const state={idempotency:new Map([['request-1',{id:'batch-1'}]]),idempotencyMeta:new Map([['request-1',{requestHash:'abc',createdAt:'2026-08-18T00:00:00Z',expiresAt:'2026-08-25T00:00:00Z'}]])};
  await repo.save(state);
  const record=calls.find(x=>/INSERT INTO idempotency_records/.test(x.sql));assert.equal(record.args[1],'request-1');assert.equal(record.args[2],'abc');assert.equal(calls.some(x=>/site_snapshots/.test(x.sql)),false);assert.match(calls.at(-2).sql,/site_state_versions SET version=version\+1/);assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(repo.version,1);
});

test('postgres repository hydrates normalized rows and idempotency maps',async()=>{
  const siteId='d804be5e-1c77-4a9c-a456-b98a51497bea';const query=async sql=>{if(/SELECT id FROM sites/.test(sql))return{rows:[{id:siteId}]};if(/FROM idempotency_records/.test(sql))return{rows:[{idempotency_key:'x',response:{id:'1'},request_hash:'abc',created_at:'2026-08-18T00:00:00Z',expires_at:'2026-08-25T00:00:00Z'}]};if(/SELECT version FROM site_state_versions/.test(sql))return{rows:[{version:4}]};return{rows:[]}};
  const repo=Object.create(PostgresRepository.prototype);Object.assign(repo,{siteCode:'IRAN',siteId,version:0,hashes:new Map(),pool:{query}});
  const state=await repo.load();assert.equal(state.idempotency.get('x').id,'1');assert.equal(state.idempotencyMeta.get('x').requestHash,'abc');assert.equal(repo.version,4);
});

test('high-growth collections persist only deltas instead of rewriting history',async()=>{
  const calls=[];let version=0;const query=async(sql,args)=>{calls.push({sql,args});if(/SELECT version/.test(sql))return{rows:[{version}]};if(/site_state_versions SET version/.test(sql))version++;return{rows:[]}};
  const repo=Object.create(PostgresRepository.prototype);Object.assign(repo,{siteCode:'IRAN',siteId:'d804be5e-1c77-4a9c-a456-b98a51497bea',version:0,hashes:new Map(),pool:{query}});
  const at='2026-08-18T00:00:00Z',id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,state={
    tasks:[{id:id(1),title:'task',zone:'QC',priority:1,status:'OPEN',stateHistory:[],createdAt:at}],
    qualityChecks:[{id:id(2),batchId:id(20),result:'APPROVED',notes:'',createdAt:at}],
    audit:[{id:id(3),type:'TEST',entityId:id(30),deviceId:'SYSTEM',payload:{},occurredAt:at}],
    outbox:[{id:id(3),type:'TEST',entityId:id(30),deviceId:'SYSTEM',payload:{},occurredAt:at,status:'PENDING'}],
    configurationVersions:[{id:id(4),scope:'PACKAGING',sequence:1,status:'DRAFT',values:{},createdAt:at}],
    overrides:[{id:id(5),ruleCode:'FIFO',reason:'test',requestedBy:id(50),status:'PENDING',createdAt:at}],
    internalTransfers:[{id:id(6),sourceSite:'DUBAI',shipmentCode:'S-1',manifest:{},receivedAt:at}],
    idempotency:new Map([['key-1',{id:id(1)}]]),idempotencyMeta:new Map([['key-1',{requestHash:'one',createdAt:at,expiresAt:'2099-01-01T00:00:00Z'}]])
  };
  await repo.save(state);calls.length=0;await repo.save(state);
  const highGrowthInsert=/INSERT INTO (tasks|quality_checks|audit_events|outbox_events|configuration_versions|manager_overrides|internal_transfers|idempotency_records)/;
  assert.equal(calls.filter(x=>highGrowthInsert.test(x.sql)).length,0,'an unchanged save must issue no history/entity upserts');
  state.tasks[0].status='IN_PROGRESS';state.audit.push({id:id(7),type:'NEXT',entityId:id(70),deviceId:'SYSTEM',payload:{},occurredAt:at});state.outbox.push({id:id(7),type:'NEXT',entityId:id(70),deviceId:'SYSTEM',payload:{},occurredAt:at,status:'PENDING'});state.idempotency.set('key-2',{id:id(7)});state.idempotencyMeta.set('key-2',{requestHash:'two',createdAt:at,expiresAt:'2099-01-01T00:00:00Z'});calls.length=0;await repo.save(state);
  assert.equal(calls.filter(x=>/INSERT INTO tasks/.test(x.sql)).length,1);assert.equal(calls.filter(x=>/INSERT INTO audit_events/.test(x.sql)).length,1);assert.equal(calls.filter(x=>/INSERT INTO outbox_events/.test(x.sql)).length,1);assert.equal(calls.filter(x=>/INSERT INTO idempotency_records/.test(x.sql)).length,1);
});

test('history archiving moves only old terminal outbox and unreferenced audit rows',async()=>{
  const calls=[];const query=async(sql,args)=>{calls.push({sql,args});return{rows:/event_kind,event_id/.test(sql)?[{event_id:'x'}]:[]}};const repo=Object.create(PostgresRepository.prototype);Object.assign(repo,{siteId:'d804be5e-1c77-4a9c-a456-b98a51497bea',pool:{query}});
  const result=await repo.archiveHistory({auditRetentionDays:730,outboxRetentionDays:60});assert.deepEqual(result,{audit:1,outbox:1});assert.equal(calls[0].sql,'BEGIN');assert.match(calls[1].sql,/status IN \('DELIVERED','DEAD_LETTER'\)/);assert.match(calls[2].sql,/NOT EXISTS\(SELECT 1 FROM outbox_events/);assert.deepEqual(calls[1].args.slice(1),['60']);assert.deepEqual(calls[2].args.slice(1),['730']);assert.equal(calls.at(-1).sql,'COMMIT');
});

test('real PostgreSQL archives old delivered history before removing it from the working set',{skip:!process.env.DATABASE_URL},async()=>{
  const repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`ARCH-${Date.now()}`}),event={id:randomUUID(),site:'ARCHIVE',type:'ARCHIVE_TEST',entityId:randomUUID(),deviceId:'SYSTEM',payload:{proof:true},occurredAt:'2020-01-01T00:00:00.000Z'};
  try{await repo.save({audit:[event],outbox:[{...event,status:'DELIVERED',attempts:1,deliveredAt:'2020-01-01T00:01:00.000Z'}],idempotency:new Map(),idempotencyMeta:new Map()});const moved=await repo.archiveHistory({auditRetentionDays:1,outboxRetentionDays:1});assert.deepEqual(moved,{audit:1,outbox:1});const active=await repo.pool.query('SELECT (SELECT count(*) FROM audit_events WHERE site_id=$1) audit,(SELECT count(*) FROM outbox_events WHERE site_id=$1) outbox',[repo.siteId]),archived=await repo.pool.query('SELECT event_kind,payload FROM event_history_archive WHERE site_id=$1 ORDER BY event_kind',[repo.siteId]);assert.equal(Number(active.rows[0].audit),0);assert.equal(Number(active.rows[0].outbox),0);assert.deepEqual(archived.rows.map(x=>x.event_kind),['AUDIT','OUTBOX']);assert.equal(archived.rows[0].payload.event_type,'ARCHIVE_TEST')}
  finally{await repo.pool.query('DELETE FROM event_history_archive WHERE site_id=$1',[repo.siteId]);await repo.pool.query('DELETE FROM site_state_versions WHERE site_id=$1',[repo.siteId]);await repo.pool.query('DELETE FROM sites WHERE id=$1',[repo.siteId]);await repo.close()}
});
