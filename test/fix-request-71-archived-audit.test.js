import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../src/auth.js';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { createServer } from '../src/server.js';

test('audit API optionally returns normalized PostgreSQL archive history with live events', { skip: !process.env.DATABASE_URL }, async () => {
  const site = `FR71-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  let server;
  try {
    const seeded = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: false });
    seeded.repository = repository;
    const archivedSource = seeded.record('ARCHIVE_VISIBILITY_TEST', null, { marker: 'archived' });
    seeded.persist();
    await seeded.flush();
    await repository.pool.query("UPDATE audit_events SET occurred_at=now()-interval '400 days' WHERE id=$1", [archivedSource.id]);
    await repository.pool.query("UPDATE outbox_events SET occurred_at=now()-interval '400 days',status='DELIVERED' WHERE id=$1", [archivedSource.id]);
    assert.deepEqual(await repository.archiveHistory({ auditRetentionDays: 365, outboxRetentionDays: 30 }), { audit: 1, outbox: 1 });

    const liveState = await repository.load();
    assert.equal(liveState.audit.some(event => event.id === archivedSource.id), false);
    const app = new StoreMesh({ site, initialState: liveState, seedDemoReferences: false });
    app.repository = repository;
    const auth = new AuthService({ site, secret: 'fr71-secret' });
    auth.addUser({ id: randomUUID(), username: 'admin', password: 'right', roles: ['ADMIN'] });
    server = createServer({ app, auth });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'right', deviceId: 'WEB-01' })
    });
    const token = (await login.json()).data.token;
    const headers = { authorization: `Bearer ${token}` };

    const liveResponse = await fetch(`${base}/api/audit`, { headers });
    assert.equal(liveResponse.status, 200);
    const liveItems = (await liveResponse.json()).items;
    const liveEvent = liveItems.find(event => event.type === 'LOGIN_SUCCEEDED');
    assert.ok(liveEvent);
    assert.equal(liveItems.some(event => event.id === archivedSource.id), false);

    const combinedResponse = await fetch(`${base}/api/audit?includeArchived=true`, { headers });
    assert.equal(combinedResponse.status, 200);
    const combinedItems = (await combinedResponse.json()).items;
    const archivedEvent = combinedItems.find(event => event.id === archivedSource.id);
    assert.ok(archivedEvent);
    assert.equal(archivedEvent.type, 'ARCHIVE_VISIBILITY_TEST');
    assert.deepEqual(archivedEvent.payload, { marker: 'archived' });
    assert.deepEqual(Object.keys(archivedEvent).sort(), Object.keys(liveEvent).sort());
  } finally {
    if (server) {
      server.close();
      await once(server, 'close');
    }
    await repository.close();
  }
});
