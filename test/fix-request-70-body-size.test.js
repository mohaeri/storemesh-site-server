import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AuthService } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { createServer } from '../src/server.js';

test('HTTP rejects an oversized body without mutation and accepts a normal body', async () => {
  const app = new StoreMesh();
  const auth = new AuthService({ secret: 'secret' });
  auth.addUser({ id: 'u1', username: 'receiver', password: 'right', roles: ['RECEIVING_OPERATOR'] });
  const server = createServer({ app, auth });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'receiver', password: 'right', deviceId: 'WEB-01' })
    });
    const token = (await login.json()).data.token;
    const mutate = (key, body) => fetch(`${base}/api/containers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': key
      },
      body
    });

    const auditStart = app.state.audit.length;
    const oversizedKey = 'request-70-oversized';
    const oversizedBody = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });
    const oversizedResponse = await mutate(oversizedKey, oversizedBody);
    assert.equal(oversizedResponse.status, 413);
    const oversizedFailure = await oversizedResponse.json();
    assert.equal(oversizedFailure.errorCode, 'PAYLOAD_TOO_LARGE');
    assert.equal(app.state.containers.length, 0);
    assert.equal(app.state.idempotency.has(oversizedKey), false);
    assert.equal(app.state.idempotencyMeta.has(oversizedKey), false);
    assert.equal(app.state.audit.slice(auditStart).some(event => event.result === 'SUCCESS'), false);

    const normalKey = 'request-70-normal';
    const normalResponse = await mutate(normalKey, JSON.stringify({
      type: 'BASKET',
      capacityKg: 10,
      tareWeightKg: 1,
      zone: 'RECEIVING'
    }));
    assert.equal(normalResponse.status, 201);
    const created = (await normalResponse.json()).data;
    assert.equal(app.state.containers.length, 1);
    assert.equal(app.state.idempotency.get(normalKey).id, created.id);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
