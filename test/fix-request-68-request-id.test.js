import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AuthService } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { createServer } from '../src/server.js';

test('HTTP audit replaces oversized and blank request IDs while preserving a normal correlation ID', async () => {
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
    const sendFailure = requestId => fetch(`${base}/api/receiving`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `request-id-${app.state.audit.length}`,
        'x-request-id': requestId
      },
      body: JSON.stringify({ sessionId: 'missing' })
    });

    const oversized = 'x'.repeat(10_000);
    const oversizedResponse = await sendFailure(oversized);
    assert.equal(oversizedResponse.status, 404);
    const generatedOversizedId = oversizedResponse.headers.get('x-request-id');
    assert.match(generatedOversizedId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(generatedOversizedId, oversized);
    assert.ok(app.state.audit.some(event => event.type === 'REQUEST_FAILED' && event.requestId === generatedOversizedId));

    const blankResponse = await sendFailure('   ');
    assert.equal(blankResponse.status, 404);
    const generatedBlankId = blankResponse.headers.get('x-request-id');
    assert.match(generatedBlankId, /^[0-9a-f-]{36}$/i);
    assert.ok(app.state.audit.some(event => event.type === 'REQUEST_FAILED' && event.requestId === generatedBlankId));

    const normalResponse = await sendFailure('request-68-normal');
    assert.equal(normalResponse.status, 404);
    assert.equal(normalResponse.headers.get('x-request-id'), 'request-68-normal');
    assert.ok(app.state.audit.some(event => event.type === 'REQUEST_FAILED' && event.requestId === 'request-68-normal'));
  } finally {
    server.close();
    await once(server, 'close');
  }
});
