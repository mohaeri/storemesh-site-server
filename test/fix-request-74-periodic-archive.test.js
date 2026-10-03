import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRuntimeServer } from '../src/server.js';
import { guardedHistoryCleanup } from '../support/postgres-cleanup.js';

test('runtime server exposes recurring archive action backed by real PostgreSQL', { skip: !process.env.DATABASE_URL }, async () => {
  const before = process.env.SITE_CODE;
  process.env.SITE_CODE = `FR74-${Date.now()}`;
  let server;
  try {
    server = await createRuntimeServer();
    const repository = server.storemesh.app.repository;
    const event = { id: randomUUID(), site: process.env.SITE_CODE, type: 'PERIODIC_ARCHIVE_TEST', entityId: null, deviceId: 'SYSTEM', payload: { periodic: true }, occurredAt: '2020-01-01T00:00:00.000Z', schemaVersion: 2 };
    await repository.save({ audit: [event], outbox: [{ ...event, status: 'DELIVERED', attempts: 1, deliveredAt: '2020-01-01T00:01:00.000Z' }], idempotency: new Map(), idempotencyMeta: new Map() });
    assert.equal(typeof server.archiveHistory, 'function');
    assert.deepEqual(await server.archiveHistory(), { audit: 1, outbox: 1 });
    const live = await repository.pool.query('SELECT (SELECT count(*) FROM audit_events WHERE id=$1) audit,(SELECT count(*) FROM outbox_events WHERE id=$1) outbox', [event.id]);
    assert.deepEqual([Number(live.rows[0].audit), Number(live.rows[0].outbox)], [0, 0]);
    const archived = await repository.pool.query('SELECT event_kind FROM event_history_archive WHERE event_id=$1 ORDER BY event_kind', [event.id]);
    assert.deepEqual(archived.rows.map(row => row.event_kind), ['AUDIT', 'OUTBOX']);
    await guardedHistoryCleanup(repository.pool, repository.siteId);
  } finally {
    if (server?.listening) { server.close(); await once(server, 'close'); }
    else server?.close();
    await server?.storemesh.app.repository.close();
    before === undefined ? delete process.env.SITE_CODE : process.env.SITE_CODE = before;
  }
});
