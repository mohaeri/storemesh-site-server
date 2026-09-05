import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AuthService } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { createServer } from '../src/server.js';

const exerciseAuditIp = async trustProxy => {
  const app = new StoreMesh();
  const auth = new AuthService({ secret: 'secret' });
  auth.addUser({ id: 'u1', username: 'receiver', password: 'right', roles: ['RECEIVING_OPERATOR'] });
  const server = createServer({ app, auth, trustProxy });
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
    const requestId = trustProxy ? 'trusted-proxy' : 'untrusted-proxy';
    const response = await fetch(`${base}/api/receiving`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': requestId,
        'x-forwarded-for': '9.9.9.9, 8.8.8.8',
        'x-request-id': requestId
      },
      body: JSON.stringify({ sessionId: 'missing' })
    });
    assert.equal(response.status, 404);
    return app.state.audit.find(event => event.type === 'RESOURCE_NOT_FOUND' && event.requestId === requestId)?.ipAddress;
  } finally {
    server.close();
    await once(server, 'close');
  }
};

test('audit ignores spoofed X-Forwarded-For unless proxy trust is explicitly enabled', async () => {
  const untrustedIp = await exerciseAuditIp(false);
  assert.match(untrustedIp, /127\.0\.0\.1/);
  assert.notEqual(untrustedIp, '9.9.9.9');

  const trustedIp = await exerciseAuditIp(true);
  assert.equal(trustedIp, '9.9.9.9');
});
