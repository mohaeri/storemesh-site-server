import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import { guardedHistoryCleanup } from '../support/postgres-cleanup.js';

const key=()=>randomUUID();

test('Part A exception taxonomy and lifecycle enforce assignee start and manager-close domain transition',()=>{
  const app=new StoreMesh(),issue=app.raiseException({type:'WEIGHT_ANOMALY',entityType:'BATCH',entityId:randomUUID(),severity:'HIGH',createdBy:'creator'},key());
  assert.equal(issue.category,'Production');assert.equal(issue.status,'OPEN');assert.equal(issue.createdBy,'creator');
  app.assignException(issue.id,{assignedTo:'operator'},key());
  assert.throws(()=>app.startExceptionWork(issue.id,{actorId:'other'},key()),e=>e.code==='EXCEPTION_START_INVALID');
  app.startExceptionWork(issue.id,{actorId:'operator'},key());assert.equal(issue.status,'IN_PROGRESS');
  app.resolveException(issue.id,{decision:'RESOLVED',resolvedBy:'manager',resolutionNote:'fixed'},key());
  app.closeException(issue.id,{closedBy:'manager'},key());assert.equal(issue.status,'CLOSED');assert.equal(issue.closedBy,'manager');assert.ok(issue.closedAt);
});

test('Part B closure preserves root cause and CAPA fields',()=>{
  const app=new StoreMesh(),issue=app.raiseException({type:'UNKNOWN',entityType:'SYSTEM',severity:'WARNING'},key());assert.equal(issue.category,'System');
  app.resolveException(issue.id,{decision:'DISMISSED',resolvedBy:'manager',resolutionNote:'reviewed'},key());
  app.closeException(issue.id,{closedBy:'manager',rootCause:'sensor drift',correctiveAction:'calibrated',preventiveAction:'weekly checks'},key());
  assert.deepEqual([issue.rootCause,issue.correctiveAction,issue.preventiveAction],['sensor drift','calibrated','weekly checks']);
});

test('Part C filters combine and dashboard counts critical overdue category and area',()=>{
  let now='2026-08-29T10:00:00.000Z';const app=new StoreMesh({clock:()=>now}),batchId=randomUUID();
  const issue=app.raiseException({type:'QUALITY_HOLD',entityType:'BATCH',entityId:batchId,severity:'CRITICAL',createdBy:'alice',productionArea:'QC',product:'T'},key());issue.raisedAt='2026-08-29T09:00:00.000Z';app.assignException(issue.id,{assignedTo:'bob'},key());
  assert.deepEqual(app.searchExceptions({status:'ASSIGNED',severity:'CRITICAL',category:'Quality',operator:'alice',product:'T',batchId}).map(x=>x.id),[issue.id]);
  const report=app.reports().exceptions;assert.equal(report.critical,1);assert.equal(report.overdue,1);assert.equal(report.byCategory.Quality,1);assert.equal(report.byProductionArea.QC,1);
});

test('real PostgreSQL persists the complete exception audit record',{skip:!process.env.DATABASE_URL},async()=>{
  const siteCode=`FR54-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode});
  try{const app=new StoreMesh({site:siteCode,initialState:await repository.load()});app.repository=repository;const issue=app.raiseException({type:'SHIPMENT_DELAY',entityType:'SHIPMENT',entityId:randomUUID(),severity:'CRITICAL',createdBy:'creator',productionArea:'Dispatch'},key());app.assignException(issue.id,{assignedTo:'operator'},key());app.startExceptionWork(issue.id,{actorId:'operator'},key());app.resolveException(issue.id,{decision:'RESOLVED',resolvedBy:'manager',resolutionNote:'rerouted'},key());app.closeException(issue.id,{closedBy:'manager',rootCause:'carrier'},key());await app.flush();const stored=(await repository.load()).exceptions.find(x=>x.id===issue.id);assert.equal(stored.category,'Shipping');assert.equal(stored.status,'CLOSED');assert.equal(stored.createdBy,'creator');assert.equal(stored.assignedTo,'operator');assert.equal(stored.closedBy,'manager');assert.equal(stored.rootCause,'carrier')}
  finally{await guardedHistoryCleanup(repository.pool,repository.siteId);for(const table of['outbox_events','audit_events','idempotency_records','operational_exceptions','devices','products','suppliers','grades','sizes','zones','package_types','site_state_versions'])await repository.pool.query(`DELETE FROM ${table} WHERE site_id=$1`,[repository.siteId]);await repository.pool.query('DELETE FROM sites WHERE id=$1',[repository.siteId]);await repository.close()}
});
