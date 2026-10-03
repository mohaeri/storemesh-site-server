import test from'node:test';
import assert from'node:assert/strict';
import{once}from'node:events';
import{randomUUID}from'node:crypto';
import{StoreMesh}from'../src/domain.js';
import{AuthService}from'../src/auth.js';
import{createServer}from'../src/server.js';

test('RECEIVING_OPERATOR can create and print a basic basket but cannot create elevated container types',async()=>{
  const app=new StoreMesh(),auth=new AuthService({secret:'receiving-container-permission',site:app.site}),userId=randomUUID();
  auth.addUser({id:userId,username:'receiver',password:'right',roles:['RECEIVING_OPERATOR']});
  const server=createServer({app,auth});server.listen(0);await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'receiver',password:'right',deviceId:'RECEIVING-TERMINAL-01'})}),token=(await login.json()).data.token,headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
    const create=await fetch(`${base}/api/containers`,{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify({type:'BASKET',capacityKg:20,tareWeightKg:1,zone:'RECEIVING',designatedZones:['RECEIVING','COLD_ROOM_DIRTY']})}),created=await create.json();
    assert.equal(create.status,201);assert.equal(created.data.type,'BASKET');assert.equal(created.data.singleUse,false);
    const print=await fetch(`${base}/api/containers/${created.data.id}/label`,{method:'POST',headers:{...headers,'idempotency-key':randomUUID()}});assert.equal(print.status,201);
    const tray=await fetch(`${base}/api/containers`,{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify({type:'TRAY',capacityKg:20,zone:'RECEIVING'})}),trayError=await tray.json();
    assert.equal(tray.status,403);assert.equal(trayError.errorCode,'BASIC_CONTAINER_TYPE_FORBIDDEN');
    const elevated=await fetch(`${base}/api/containers`,{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify({type:'BASKET',capacityKg:20,zone:'RECEIVING',stage:'EXPORT'})}),elevatedError=await elevated.json();
    assert.equal(elevated.status,403);assert.equal(elevatedError.errorCode,'BASIC_CONTAINER_FIELDS_FORBIDDEN');
  }finally{server.close();await once(server,'close')}
});
