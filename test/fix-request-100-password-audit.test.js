import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {AuthService,PostgresAuthStore} from '../src/auth.js';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {createServer} from '../src/server.js';
import {guardedHistoryCleanup} from '../support/postgres-cleanup.js';

test('password change and admin reset are audited with immutable username snapshots',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR100-${Date.now()}`,repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site}),store=new PostgresAuthStore({pool:repo.pool,siteId:repo.siteId,siteCode:site}),auth=new AuthService({site,secret:'fr100-secret',store}),operatorId=randomUUID(),adminId=randomUUID();let server;
  try{
    await auth.hydrate();auth.addUser({id:operatorId,username:'historical-operator',password:'old-password',roles:['VIEWER']});auth.addUser({id:adminId,username:'security-admin',password:'admin-password',roles:['ADMIN']});await auth.flush();
    const app=new StoreMesh({site,initialState:await repo.load(),seedDemoReferences:false});app.repository=repo;server=createServer({app,auth,requireAuth:true});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,login=async(username,password)=>fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})}),operatorLogin=await login('historical-operator','old-password'),operatorToken=(await operatorLogin.json()).data.token,post=(path,token,body)=>fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    let response=await post('/api/auth/password/change',operatorToken,{currentPassword:'wrong-password',newPassword:'new-password'});assert.equal(response.status,403);
    response=await post('/api/auth/password/change',operatorToken,{currentPassword:'old-password',newPassword:'new-password'});assert.equal(response.status,200);assert.equal((await login('historical-operator','old-password')).status,401);assert.equal((await login('historical-operator','new-password')).status,200);
    const adminToken=(await(await login('security-admin','admin-password')).json()).data.token;response=await post(`/api/users/${operatorId}/password/reset`,adminToken,{newPassword:'reset-password'});assert.equal(response.status,200);assert.equal((await login('historical-operator','new-password')).status,401);assert.equal((await login('historical-operator','reset-password')).status,200);
    await app.flush();await repo.pool.query('UPDATE users SET username=$2 WHERE site_id=$1 AND external_id=$3',[repo.siteId,'renamed-operator',operatorId]);const restored=await repo.load(),changed=restored.audit.find(event=>event.type==='PASSWORD_CHANGED'),reset=restored.audit.find(event=>event.type==='PASSWORD_RESET');assert.equal(changed.actorUsername,'historical-operator');assert.equal(reset.actorUsername,'security-admin');
  }finally{
    if(server){server.close();await once(server,'close')}await guardedHistoryCleanup(repo.pool,repo.siteId);for(const table of['auth_sessions','user_roles','users','role_permissions','roles','site_state_versions'])await repo.pool.query(`DELETE FROM ${table} WHERE ${table==='role_permissions'?'role_id IN (SELECT id FROM roles WHERE site_id=$1)':'site_id=$1'}`,[repo.siteId]).catch(()=>{});await repo.pool.query('DELETE FROM sites WHERE id=$1',[repo.siteId]).catch(()=>{});await repo.close();
  }
});
