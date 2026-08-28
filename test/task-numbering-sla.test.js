import test from 'node:test';
import assert from 'node:assert/strict';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';

test('manual and automatic tasks receive sequential readable codes without collisions',()=>{
  const app=new StoreMesh({site:'IRAN'});
  const first=app.createTask({title:'Manual',zone:'QC'},'manual');
  const second=app.autoTask({id:crypto.randomUUID(),code:'B-IRAN-000001'},'Wash','WASHING');
  const third=app.createTask({title:'Another',zone:'SORTING'},'another');
  assert.deepEqual([first.code,second.code,third.code],['T-IRAN-000001','T-IRAN-000002','T-IRAN-000003']);
  assert.equal(new Set(app.state.tasks.map(x=>x.code)).size,3);
});

test('overdue is derived only for open tasks with a past due date',()=>{
  const now='2026-08-28T00:00:00.000Z',app=new StoreMesh({clock:()=>now});
  const late=app.createTask({title:'Late',zone:'QC',dueAt:'2026-08-27T00:00:00Z',expectedDurationMinutes:30},'late');
  const complete=app.createTask({title:'Done',zone:'QC',dueAt:'2026-08-27T00:00:00Z'},'done');complete.status='COMPLETED';
  const unscheduled=app.createTask({title:'No due',zone:'QC'},'none');
  assert.equal(app.taskView(late).overdue,true);
  assert.equal(app.taskView(complete).overdue,false);
  assert.equal(app.taskView(unscheduled).overdue,false);
});

test('task code and SLA fields survive PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`TASK-SLA-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{let app=new StoreMesh({site,initialState:await repository.load()});app.repository=repository;const task=app.createTask({title:'Persistent SLA',zone:'QC',dueAt:'2026-12-31T20:30:00Z',expectedDurationMinutes:45},'persist');await app.flush();app=new StoreMesh({site,initialState:await repository.load()});const loaded=app.state.tasks.find(x=>x.id===task.id);assert.equal(loaded.code,'T-'+site+'-000001');assert.equal(loaded.dueAt,'2026-12-31T20:30:00.000Z');assert.equal(loaded.expectedDurationMinutes,45)}finally{for(const table of['outbox_events','audit_events','idempotency_records','tasks','devices','products','suppliers','grades','sizes','zones','package_types','site_state_versions'])await repository.pool.query(`DELETE FROM ${table} WHERE site_id=$1`,[repository.siteId]);await repository.pool.query('DELETE FROM sites WHERE id=$1',[repository.siteId]);await repository.close()}
});
