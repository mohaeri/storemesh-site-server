import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, runSoak } from '../src/soak-runner.js';

test('soak configuration is bounded and requires PostgreSQL',()=>{
  assert.throws(()=>makeConfig({}),/DATABASE_URL/);
  assert.throws(()=>makeConfig({DATABASE_URL:'postgres://db',SOAK_ITERATIONS:'0'}),/positive integer/);
  const config=makeConfig({DATABASE_URL:'postgres://db',SOAK_ITERATIONS:'3',SOAK_DURATION_MINUTES:'5',SOAK_INTERVAL_SECONDS:'2'});
  assert.equal(config.iterations,3);assert.equal(config.durationMs,300000);assert.equal(config.intervalMs,2000);
  assert.match(config.args.join(' '),/real PostgreSQL domain chain/);
});

test('runner records successful iterations, health and database growth',async()=>{
  let clock=0,probe=0;const written=[];
  const result=await runSoak({databaseUrl:'postgres://db',iterations:2,durationMs:10000,intervalMs:10,command:'node',args:['test'],healthUrl:'http://site/health',logPath:'unused',maxAuditGrowth:5,maxOutboxGrowth:5,maxDeadLetters:0},{
    now:()=>clock,
    sleep:async ms=>{clock+=ms},
    execute:async()=>{clock+=7;return{code:0,stdout:'ok',stderr:''}},
    probeHealth:async()=>({checked:true,ok:true,status:200}),
    probeDatabase:async()=>({auditCount:probe++,outboxCount:probe,outboxPending:0,outboxDeadLetters:0}),
    write:async record=>written.push(record)
  });
  assert.equal(result.passed,true);assert.equal(result.records.length,2);assert.equal(written.length,2);
  assert.equal(written[0].durationMs,7);assert.equal(written[0].healthAfter.status,200);
});

test('runner stops and fails on a persistent health, test, growth or dead-letter signal',async()=>{
  let calls=0;const result=await runSoak({databaseUrl:'postgres://db',iterations:20,durationMs:10000,intervalMs:1,command:'node',args:[],healthUrl:null,logPath:'unused',maxAuditGrowth:1,maxOutboxGrowth:1,maxDeadLetters:0},{
    now:()=>0,sleep:async()=>{},write:async()=>{},execute:async()=>({code:1,stdout:'',stderr:'failed'}),
    probeHealth:async()=>({checked:false}),probeDatabase:async()=>calls++?{auditCount:10,outboxCount:10,outboxPending:2,outboxDeadLetters:1}:{auditCount:0,outboxCount:0,outboxPending:0,outboxDeadLetters:0}
  });
  assert.equal(result.passed,false);assert.equal(result.records.length,1);
  assert.ok(result.records[0].violations.some(x=>x.includes('business-chain')));
  assert.ok(result.records[0].violations.some(x=>x.includes('audit growth')));
  assert.ok(result.records[0].violations.some(x=>x.includes('dead letters')));
});
