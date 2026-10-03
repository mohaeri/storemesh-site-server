import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { AuthService } from '../src/auth.js';
import { createServer } from '../src/server.js';

test('consumable write-off and deletion routes enforce permission, reason, and zero stock', async () => {
  const site='CONSUMABLE-WRITE-OFF',app=new StoreMesh({site}),auth=new AuthService({secret:'consumable-write-off-secret',site});
  auth.addUser({id:randomUUID(),username:'admin',password:'right',roles:['ADMIN']});
  auth.addUser({id:randomUUID(),username:'viewer',password:'right',roles:['VIEWER']});
  const item=app.createConsumable({code:'BROKEN-STOCK',name:'Broken stock',unit:'EA',reorderThreshold:0},randomUUID());
  app.receiveConsumable(item.id,{quantity:3,source:'supplier'},randomUUID());
  const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=async username=>(await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'right',deviceId:'WEB-CONSUMABLE'})})).json()).data.token;
  const mutate=(path,token,method='POST',payload)=>fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':randomUUID()},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  try{
    const admin=await login('admin'),viewer=await login('viewer');
    assert.equal((await mutate(`/api/consumables/${item.id}/zero`,viewer,'POST',{reason:'broken'})).status,403);
    assert.equal((await mutate(`/api/consumables/${item.id}`,admin,'DELETE')).status,409);
    assert.equal((await mutate(`/api/consumables/${item.id}/zero`,admin,'POST',{})).status,400);
    assert.equal((await mutate(`/api/consumables/${item.id}/zero`,admin,'POST',{reason:'پاره شدن پاکت‌ها'})).status,201);
    assert.equal((await mutate(`/api/consumables/${item.id}`,admin,'DELETE')).status,201);
    const list=await (await fetch(`${base}/api/consumables`,{headers:{authorization:`Bearer ${admin}`}})).json();
    assert.equal(list.items.some(row=>row.id===item.id),false);
    const transactions=await (await fetch(`${base}/api/consumables/${item.id}/transactions`,{headers:{authorization:`Bearer ${admin}`}})).json();
    assert.ok(transactions.items.some(row=>row.type==='WRITE_OFF'&&row.reason==='پاره شدن پاکت‌ها'&&row.balance===0));
  }finally{server.close();await once(server,'close')}
});
