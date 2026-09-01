import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

test('audit schemaVersion survives PostgreSQL reload and archival unchanged', { skip: !process.env.DATABASE_URL }, async () => {
  const site = `FR72-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  try {
    const app = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: false });
    app.repository = repository;
    const event = app.record('SCHEMA_VERSION_PERSISTENCE_TEST', null, { marker: 'v7' });
    event.schemaVersion = 7;
    app.state.outbox.find(item => item.id === event.id).schemaVersion = 7;
    app.persist();
    await app.flush();

    const stored = await repository.pool.query('SELECT schema_version FROM audit_events WHERE id=$1', [event.id]);
    assert.equal(stored.rows[0].schema_version, 7);
    const reloaded = await repository.load();
    assert.equal(reloaded.audit.find(item => item.id === event.id).schemaVersion, 7);

    await repository.pool.query("UPDATE audit_events SET occurred_at=now()-interval '400 days' WHERE id=$1", [event.id]);
    await repository.pool.query("UPDATE outbox_events SET occurred_at=now()-interval '400 days',status='DELIVERED' WHERE id=$1", [event.id]);
    assert.deepEqual(await repository.archiveHistory({ auditRetentionDays: 365, outboxRetentionDays: 30 }), { audit: 1, outbox: 1 });
    const archived = await repository.archivedAuditEvents();
    assert.equal(archived.find(item => item.id === event.id).schemaVersion, 7);
  } finally {
    await repository.close();
  }
});
