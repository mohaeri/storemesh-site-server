import test from'node:test';import assert from'node:assert/strict';import{once}from'node:events';import{AuthService}from'../src/auth.js';import{StoreMesh}from'../src/domain.js';import{createServer}from'../src/server.js';

test('real HTTP login carries assigned skills and enables skill-gated task claim',async()=>{
  const adminId=crypto.randomUUID(),operatorId=crypto.randomUUID(),app=new StoreMesh(),auth=new AuthService({secret:'skill-http-secret'});
  auth.addUser({id:adminId,username:'admin',password:'right',roles:['ADMIN']});auth.addUser({id:operatorId,username:'operator',password:'right',roles:['RECEIVING_OPERATOR']});
  const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const login=async username=>{const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'right',deviceId:'TEST-TERMINAL-01'})});return(await response.json()).data.token},call=(path,token,{method='POST',body,key=crypto.randomUUID()}={})=>fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    const adminToken=await login('admin'),staleOperatorToken=await login('operator'),operatorSession=app.openSession(operatorId,'TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR');
    const skillResponse=await call('/api/skills',adminToken,{body:{code:'CALIBRATED_SCALE',name:'Calibrated scale operation'}}),skill=(await skillResponse.json()).data;
    const taskResponse=await call('/api/tasks',adminToken,{body:{title:'Certified weighing',zone:'RECEIVING',requiredSkillId:skill.id}}),task=(await taskResponse.json()).data;
    assert.equal((await call(`/api/tasks/${task.id}/claim`,staleOperatorToken,{body:{sessionId:operatorSession.id}})).status,403);
    assert.equal((await call(`/api/users/${operatorId}/skills`,adminToken,{body:{skillId:skill.id}})).status,201);
    assert.equal((await call(`/api/tasks/${task.id}/claim`,staleOperatorToken,{body:{sessionId:operatorSession.id}})).status,403,'existing JWT must not gain privileges retroactively');
    const skilledToken=await login('operator'),claims=auth.verify(skilledToken);assert.deepEqual(claims.skills,[skill.id]);
    const claim=await call(`/api/tasks/${task.id}/claim`,skilledToken,{body:{sessionId:operatorSession.id}});assert.equal(claim.status,201);assert.equal((await claim.json()).data.assignedTo,operatorId);
    assert.equal((await call(`/api/users/${operatorId}/skills/${skill.id}`,adminToken,{method:'DELETE'})).status,201);
    const revokedToken=await login('operator');assert.deepEqual(auth.verify(revokedToken).skills,[]);
  }finally{server.close();await once(server,'close')}
});
