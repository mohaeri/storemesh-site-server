import test from 'node:test';
import assert from 'node:assert/strict';
import { authRequiredFromEnvironment } from '../src/auth.js';
import { createServer } from '../src/server.js';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('missing AUTH_REQUIRED enforces authentication by default',async()=>{
  assert.equal(authRequiredFromEnvironment({}),true);
  const server=createServer(),base=await listen(server);
  try{
    const response=await fetch(`${base}/api/inventory`);
    assert.equal(response.status,401);
    assert.equal((await response.json()).errorCode,'AUTHENTICATION_REQUIRED');
  }finally{await close(server)}
});

test('explicit opt-out is limited to non-production environments',()=>{
  assert.equal(authRequiredFromEnvironment({NODE_ENV:'development',AUTH_REQUIRED:'false'}),false);
  assert.throws(()=>authRequiredFromEnvironment({NODE_ENV:'production'}),/AUTH_REQUIRED=true/);
  assert.throws(()=>authRequiredFromEnvironment({NODE_ENV:'production',AUTH_REQUIRED:'false'}),/AUTH_REQUIRED=true/);
  assert.equal(authRequiredFromEnvironment({NODE_ENV:'production',AUTH_REQUIRED:'true'}),true);
});
