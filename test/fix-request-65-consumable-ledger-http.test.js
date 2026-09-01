import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { AuthService } from '../src/auth.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { createServer } from '../src/server.js';

const pgOnly = { skip: !process.env.DATABASE_URL };

test('consumable ledger HTTP routes enforce permission, scope and newest-first ordering', pgOnly, async () => {
  const site = `FR65-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  let now = '2026-08-30T08:00:00.000Z';
  const app = new StoreMesh({ site, clock: () => now, initialState: await repository.load() });
  app.repository = repository;
  const auth = new AuthService({ secret: 'fr65-http-test-secret', site });
  auth.addUser({ id: randomUUID(), username: 'reader', password: 'right', roles: ['VIEWER'] });
  auth.addUser({ id: randomUUID(), username: 'no-read', password: 'right', roles: [] });
  const first = app.createConsumable({ code: 'FR65_ONE', name: 'First', reorderThreshold: 0 }, randomUUID());
  const second = app.createConsumable({ code: 'FR65_TWO', name: 'Second', reorderThreshold: 0 }, randomUUID());
  app.receiveConsumable(first.id, { quantity: 5, source: 'old vendor', receivedAt: now }, randomUUID());
  now = '2026-08-30T09:00:00.000Z';
  app.receiveConsumable(second.id, { quantity: 7, source: 'other vendor', receivedAt: now }, randomUUID());
  now = '2026-08-30T10:00:00.000Z';
  app.receiveConsumable(first.id, { quantity: 3, source: 'new vendor', receivedAt: now }, randomUUID());
  now = '2026-08-30T11:00:00.000Z';
  app.consumeConsumableDirect(first.code, 2, 'HTTP_TEST', randomUUID());
  app.persist();
  await app.flush();

  const server = createServer({ app, auth });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async username => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'right', deviceId: 'WEB-FR65' })
    });
    return (await response.json()).data.token;
  };
  const get = (path, token) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });

  try {
    const denied = await login('no-read');
    assert.equal((await get(`/api/consumables/${first.id}/receipts`, denied)).status, 403);
    assert.equal((await get(`/api/consumables/${first.id}/transactions`, denied)).status, 403);

    const reader = await login('reader');
    const receiptsResponse = await get(`/api/consumables/${first.id}/receipts`, reader);
    assert.equal(receiptsResponse.status, 200);
    const receipts = (await receiptsResponse.json()).items;
    assert.deepEqual(receipts.map(item => item.source), ['new vendor', 'old vendor']);
    assert.ok(receipts.every(item => item.consumableId === first.id));

    const transactionsResponse = await get(`/api/consumables/${first.id}/transactions`, reader);
    assert.equal(transactionsResponse.status, 200);
    const transactions = (await transactionsResponse.json()).items;
    assert.deepEqual(transactions.map(item => item.type), ['CONSUMPTION', 'RECEIPT', 'RECEIPT']);
    assert.ok(transactions.every(item => item.consumableId === first.id));

    for (const suffix of ['receipts', 'transactions']) {
      const missing = await get(`/api/consumables/${randomUUID()}/${suffix}`, reader);
      assert.equal(missing.status, 200);
      assert.deepEqual(await missing.json(), { items: [] });
    }
  } finally {
    server.close();
    await once(server, 'close');
    await repository.close();
  }
});
