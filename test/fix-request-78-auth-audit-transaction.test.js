import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AuthService, PostgresAuthStore } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { createServer } from '../src/server.js';
import { guardedHistoryCleanup } from '../support/postgres-cleanup.js';

test('auth mutation and audit share one PostgreSQL transaction under failure and concurrency',{skip:!process.env.DATABASE_URL},async()=>{
  const siteCode='FR78-'+Date.now(),repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode}),store=new PostgresAuthStore({pool:repo.pool,siteId:repo.siteId,siteCode}),auth=new AuthService({secret:'fr78-transaction-secret',site:siteCode,store}),adminId=randomUUID(),userId=randomUUID();
  let server;
  try{
    await auth.hydrate();auth.addUser({id:adminId,username:'fr78-admin',password:'right',roles:['ADMIN']});auth.addUser({id:userId,username:'fr78-user',password:'right',roles:['VIEWER']});await auth.flush();
    const app=new StoreMesh({site:siteCode,initialState:await repo.load(),seedDemoReferences:false});app.repository=repo;server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port,login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'fr78-admin',password:'right'})}),token=(await login.json()).data.token,assign=roleCode=>fetch(base+'/api/users/'+userId+'/roles',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({roleCode})});
    const realWrite=repo.writeAuditEvent.bind(repo);repo.writeAuditEvent=async()=>{throw new Error('forced audit insert failure')};
    assert.equal((await assign('RECEIVING_OPERATOR')).status,500);await app.flush();
    const failedRole=await repo.pool.query("SELECT 1 FROM user_roles ur JOIN users u ON u.id=ur.user_id JOIN roles r ON r.id=ur.role_id WHERE ur.site_id=$1 AND u.external_id=$2 AND r.code='RECEIVING_OPERATOR'",[repo.siteId,userId]),failedAudit=await repo.pool.query("SELECT 1 FROM audit_events WHERE site_id=$1 AND event_type='USER_ROLE_ASSIGNED' AND entity_id=$2",[repo.siteId,userId]);
    assert.equal(failedRole.rowCount,0);assert.equal(failedAudit.rowCount,0);assert.equal(auth.userById(userId).roles.includes('RECEIVING_OPERATOR'),false);
    repo.writeAuditEvent=realWrite;const responses=await Promise.all([assign('RECEIVING_OPERATOR'),assign('STORAGE_OPERATOR')]);assert.deepEqual(responses.map(x=>x.status).sort(),[201,201]);await app.flush();
    const restoredAuth=new AuthService({secret:'fr78-transaction-secret',site:siteCode,store});await restoredAuth.hydrate();assert.ok(restoredAuth.userById(userId).roles.includes('RECEIVING_OPERATOR'));assert.ok(restoredAuth.userById(userId).roles.includes('STORAGE_OPERATOR'));const audits=await repo.pool.query("SELECT event_type,payload->>'roleCode' role_code FROM audit_events WHERE site_id=$1 AND event_type='USER_ROLE_ASSIGNED' AND entity_id=$2",[repo.siteId,userId]);assert.deepEqual(audits.rows.map(x=>x.role_code).sort(),['RECEIVING_OPERATOR','STORAGE_OPERATOR']);
  }finally{if(server){server.close();await once(server,'close')}await guardedHistoryCleanup(repo.pool,repo.siteId);for(const table of['outbox_events','audit_events','idempotency_records','auth_sessions','user_roles','users','role_permissions','roles','site_state_versions'])await repo.pool.query('DELETE FROM '+table+' WHERE '+(table==='role_permissions'?'role_id IN (SELECT id FROM roles WHERE site_id=$1)':'site_id=$1'),[repo.siteId]).catch(()=>{});await repo.pool.query('DELETE FROM sites WHERE id=$1',[repo.siteId]).catch(()=>{});await repo.close()}
});
