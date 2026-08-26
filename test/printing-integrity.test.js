import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';

function fixture(app=new StoreMesh()){
  const session=app.openSession('printer-operator','TEST-DEVICE');
  const container=app.createContainer({capacityKg:10},randomUUID());
  app.requestContainerLabel(container.id,randomUUID());
  const job=app.state.printJobs.find(x=>x.entityId===container.id);
  app.claimPrint(job.id,session.id);
  app.failPrint(job.id,'paper jam',session.id);
  return {app,session,container,job};
}

test('reprint requires and records a non-empty reason',()=>{
  const {app,session,job}=fixture();
  assert.throws(()=>app.retryPrint(job.id,job.label,session.id),e=>e.code==='PRINT_RETRY_REASON_REQUIRED');
  const retry=app.retryPrint(job.id,job.label,session.id,'  paper replaced  ');
  assert.equal(app.state.printAttempts.find(x=>x.id===retry.id).retryReason,'paper replaced');
  assert.equal(app.state.audit.findLast(x=>x.type==='LABEL_PRINT_REQUEUED').payload.reason,'paper replaced');
});

test('active PRINTING threshold raises one excessive-reprint exception per label',()=>{
  const {app,session,job}=fixture();
  app.state.configurationVersions.push({id:randomUUID(),scope:'PRINTING',status:'ACTIVE',values:{reprintThreshold:1}});
  let retry=app.retryPrint(job.id,job.label,session.id,'retry one');
  app.failPrint(retry.id,'still broken',session.id);
  retry=app.retryPrint(retry.id,retry.label,session.id,'retry two');
  app.failPrint(retry.id,'still broken',session.id);
  app.retryPrint(retry.id,retry.label,session.id,'retry three');
  assert.equal(app.state.exceptions.filter(x=>x.type==='EXCESSIVE_REPRINT_COUNT').length,1);
});

test('reason and automatic failure-exception resolution survive PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR14-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    const {session,job}=fixture(app),retry=app.retryPrint(job.id,job.label,session.id,'verified maintenance');
    app.completePrint(retry.id,session.id);await app.flush();
    const restored=await repository.load(),attempt=restored.printAttempts.find(x=>x.id===retry.id),failure=restored.exceptions.find(x=>x.type==='MISSING_OR_FAILED_LABEL'&&x.entityId===job.entityId);
    assert.equal(attempt.retryReason,'verified maintenance');assert.equal(failure.status,'RESOLVED');assert.equal(failure.resolvedBy,'SYSTEM');assert.match(failure.resolutionNote,/successful print retry/i);
  }finally{await repository.close()}
});
