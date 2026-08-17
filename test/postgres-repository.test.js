import test from 'node:test';import assert from 'node:assert/strict';import { PostgresRepository } from '../src/postgres-repository.js';

test('postgres repository serializes idempotency and performs an atomic upsert',async()=>{
  const calls=[];const repo=Object.create(PostgresRepository.prototype);repo.siteCode='IRAN';repo.pool={query:async(sql,args)=>{calls.push({sql,args});return{rows:[]}}};
  await repo.save({batches:[],idempotency:new Map([['request-1',{id:'batch-1'}]])});
  assert.match(calls[0].sql,/ON CONFLICT\(site_code\)/);assert.deepEqual(calls[0].args[1].idempotency,[['request-1',{id:'batch-1'}]]);
});

test('postgres repository hydrates maps from snapshots',async()=>{
  const repo=Object.create(PostgresRepository.prototype);repo.siteCode='IRAN';repo.pool={query:async()=>({rows:[{state:{batches:[],idempotency:[['x',{id:'1'}]]}}]})};
  const state=await repo.load();assert.equal(state.idempotency.get('x').id,'1');
});
