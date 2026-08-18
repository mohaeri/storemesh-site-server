import test from 'node:test';import assert from 'node:assert/strict';import { PostgresRepository } from '../src/postgres-repository.js';

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
