import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{StoreMesh,PRINT_REASON_CODES}from'../src/domain.js';
import{PostgresRepository}from'../src/postgres-repository.js';

const key=()=>randomUUID();

test('print failure rejects empty and invalid reasons and persists every allowed code',{skip:!process.env.DATABASE_URL},async()=>{const site=`FR87-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});try{const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;const session=app.openSession('printer-operator','TEST-DEVICE','PRINTING','PACKAGING_OPERATOR');for(const reason of['','NOT_A_REASON'])assert.throws(()=>app.failPrint(key(),reason,session.id),error=>error.code==='PRINT_FAIL_REASON_INVALID');const jobs=[];for(const reasonCode of PRINT_REASON_CODES){const container=app.createContainer({capacityKg:10},key()),job=app.requestContainerLabel(container.id,key()).printJob;app.claimPrint(job.id,session.id);assert.equal(app.failPrint(job.id,reasonCode.toLowerCase(),session.id).lastError,reasonCode);jobs.push({id:job.id,reasonCode})}await app.flush();const restored=await repository.load();for(const expected of jobs){const attempt=restored.printAttempts.find(x=>x.id===expected.id),job=restored.printJobs.find(x=>x.id===expected.id);assert.equal(attempt.error,expected.reasonCode);assert.equal(job.lastError,expected.reasonCode)}}finally{await repository.close()}});
