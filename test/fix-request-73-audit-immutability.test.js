import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const rejected = error => error?.code === '55000';

test('audit history is database-enforced append-only with a transaction-local archive guard', { skip: !process.env.DATABASE_URL }, async () => {
  const site = `FR73-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  try {
    const app = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: false, clock: () => '2020-01-01T00:00:00.000Z' });
    app.repository = repository;
    const archivedSource = app.record('IMMUTABILITY_ARCHIVE_TEST', null, { marker: 'original' });
    app.persist();
    await app.flush();

    await assert.rejects(repository.pool.query("UPDATE audit_events SET payload='{}'::jsonb WHERE id=$1", [archivedSource.id]), rejected);
    await assert.rejects(repository.pool.query('DELETE FROM audit_events WHERE id=$1', [archivedSource.id]), rejected);
    const unchanged = await repository.pool.query('SELECT payload FROM audit_events WHERE id=$1', [archivedSource.id]);
    assert.deepEqual(unchanged.rows[0].payload, { marker: 'original' });

    await repository.pool.query("UPDATE outbox_events SET status='DELIVERED' WHERE id=$1", [archivedSource.id]);
    assert.deepEqual(await repository.archiveHistory({ auditRetentionDays: 365, outboxRetentionDays: 30 }), { audit: 1, outbox: 1 });

    await assert.rejects(repository.pool.query("UPDATE event_history_archive SET payload='{}'::jsonb WHERE event_kind='AUDIT' AND event_id=$1", [archivedSource.id]), rejected);
    await assert.rejects(repository.pool.query("DELETE FROM event_history_archive WHERE event_kind='AUDIT' AND event_id=$1", [archivedSource.id]), rejected);
    const archived = await repository.pool.query("SELECT payload FROM event_history_archive WHERE event_kind='AUDIT' AND event_id=$1", [archivedSource.id]);
    assert.deepEqual(archived.rows[0].payload.payload, { marker: 'original' });

    const guarded = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: false });
    guarded.repository = repository;
    const guardedDelete = guarded.record('GUARDED_DELETE_TEST', null, {});
    const leakProbe = guarded.record('GUARD_LEAK_TEST', null, {});
    guarded.persist();
    await guarded.flush();
    await repository.pool.query('DELETE FROM outbox_events WHERE id=$1', [guardedDelete.id]);

    const client = await repository.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.archiving = 'on'");
      const result = await client.query('DELETE FROM audit_events WHERE id=$1', [guardedDelete.id]);
      assert.equal(result.rowCount, 1);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await assert.rejects(repository.pool.query('DELETE FROM audit_events WHERE id=$1', [leakProbe.id]), rejected);
    const stillPresent = await repository.pool.query('SELECT count(*) FROM audit_events WHERE id=$1', [leakProbe.id]);
    assert.equal(Number(stillPresent.rows[0].count), 1);
  } finally {
    await repository.close();
  }
});
