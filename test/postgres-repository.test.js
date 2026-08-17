import test from 'node:test';import assert from 'node:assert/strict';import { PostgresRepository } from '../src/postgres-repository.js';

test('postgres repository serializes idempotency and performs an atomic upsert',async()=>{
  const calls=[];const repo=Object.create(PostgresRepository.prototype);repo.siteCode='IRAN';repo.pool={query:async(sql,args)=>{calls.push({sql,args});return{rows:[]}}};
  repo.siteId='d804be5e-1c77-4a9c-a456-b98a51497bea';
  await repo.save({batches:[],idempotency:new Map([['request-1',{id:'batch-1'}]])});
  const snapshot=calls.find(x=>/site_snapshots/.test(x.sql)),idempotency=calls.find(x=>/idempotency_records/.test(x.sql));assert.match(snapshot.sql,/ON CONFLICT\(site_code\)/);assert.deepEqual(snapshot.args[1].idempotency,[['request-1',{id:'batch-1'}]]);assert.equal(idempotency.args[1],'request-1');assert.equal(calls.at(-1).sql,'COMMIT');
});

test('postgres repository hydrates maps from snapshots',async()=>{
  const repo=Object.create(PostgresRepository.prototype);repo.siteCode='IRAN';repo.pool={query:async()=>({rows:[{state:{batches:[],idempotency:[['x',{id:'1'}]]}}]})};
  const state=await repo.load();assert.equal(state.idempotency.get('x').id,'1');
});
