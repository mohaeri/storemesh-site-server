import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AuthService } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { createServer } from '../src/server.js';

test('HTTP mutations reject oversized idempotency keys and preserve normal-key deduplication', async () => {
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
    const createContainer = (key, body) => fetch(`${base}/api/containers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': key
      },
      body: JSON.stringify(body)
    });

    const oversizedKey = 'k'.repeat(10_000);
    const beforeIdempotencyCount = app.state.idempotency.size;
    const oversizedResponse = await createContainer(oversizedKey, { capacityKg: 10, tareWeightKg: 1 });
    assert.equal(oversizedResponse.status, 400);
    const oversizedFailure = await oversizedResponse.json();
    assert.equal(oversizedFailure.errorCode, 'IDEMPOTENCY_KEY_INVALID');
    assert.equal(app.state.idempotency.size, beforeIdempotencyCount);
    assert.equal(app.state.idempotency.has(oversizedKey), false);
    assert.equal(app.state.idempotencyMeta.has(oversizedKey), false);
    assert.equal(app.state.containers.length, 0);

    const normalKey = 'request-69-normal';
    const input = { type: 'BASKET', capacityKg: 10, tareWeightKg: 1, zone: 'RECEIVING' };
    const firstResponse = await createContainer(normalKey, input);
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()).data;
    const secondResponse = await createContainer(normalKey, input);
    assert.equal(secondResponse.status, 201);
    const second = (await secondResponse.json()).data;
    assert.equal(second.id, first.id);
    assert.equal(app.state.containers.length, 1);
    assert.equal(app.state.idempotency.get(normalKey).id, first.id);
    assert.equal(app.state.idempotencyMeta.has(normalKey), true);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
