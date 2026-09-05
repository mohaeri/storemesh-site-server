import test from 'node:test';
import assert from 'node:assert/strict';
import {StoreMesh} from '../src/domain.js';
import {OutboxPublisher} from '../src/outbox-publisher.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {guardedHistoryCleanup} from '../support/postgres-cleanup.js';

test('real PostgreSQL preserves backoff and a dead letter can be requeued then delivered',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR101-${Date.now()}`,repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});let now=Date.parse('2026-09-05T00:00:00Z'),calls=0;
  try{
    const app=new StoreMesh({site,initialState:await repo.load(),seedDemoReferences:false});app.repository=repo;const event=app.record('BACKOFF_TEST',null,{});app.persist();await app.flush();
    const failing=new OutboxPublisher({app,cloudUrl:'http://cloud',siteKey:'key',maxAttempts:2,baseBackoffMs:1000,jitterRatio:0,clock:()=>now,random:()=>.5,fetchImpl:async()=>{calls++;return{ok:false,status:503}}});
    await assert.rejects(()=>failing.flushOnce());assert.equal(calls,1);assert.equal(app.state.outbox.find(x=>x.id===event.id).nextAttemptAt,'2026-09-05T00:00:01.000Z');assert.deepEqual(await failing.flushOnce(),{accepted:0,duplicates:0});assert.equal(calls,1);
    let restored=await repo.load();assert.equal(restored.outbox.find(x=>x.id===event.id).nextAttemptAt,'2026-09-05T00:00:01.000Z');now+=1000;await assert.rejects(()=>failing.flushOnce());assert.equal(app.state.outbox.find(x=>x.id===event.id).status,'DEAD_LETTER');
    app.requeueOutbox(event.id);await app.flush();const delivering=new OutboxPublisher({app,cloudUrl:'http://cloud',siteKey:'key',clock:()=>now,fetchImpl:async(_url,options)=>{const items=JSON.parse(options.body).items;return{ok:true,json:async()=>({accepted:items.length,acceptedIds:items.map(x=>x.id),duplicates:0,duplicateIds:[],rejected:[]})}}});await delivering.flushOnce();restored=await repo.load();assert.equal(restored.outbox.find(x=>x.id===event.id).status,'DELIVERED');
  }finally{await guardedHistoryCleanup(repo.pool,repo.siteId);await repo.pool.query('DELETE FROM site_state_versions WHERE site_id=$1',[repo.siteId]).catch(()=>{});await repo.pool.query('DELETE FROM sites WHERE id=$1',[repo.siteId]).catch(()=>{});await repo.close()}
});
