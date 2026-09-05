import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

test('manual task zone and priority validation survive real PostgreSQL persistence', { skip: !process.env.DATABASE_URL }, async () => {
  const site = `FR89-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  try {
    const app = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: true });
    app.repository = repository;
    assert.throws(
      () => app.createTask({ title: 'Unknown zone', zone: 'NOT_A_ZONE' }, randomUUID()),
      error => error.code === 'MASTER_DATA_REFERENCE_INVALID' && error.status === 400,
    );
    const qc = app.state.masterData.zones.find(zone => zone.code === 'QC');
    qc.status = 'INACTIVE';
    assert.throws(
      () => app.createTask({ title: 'Inactive zone', zone: 'QC' }, randomUUID()),
      error => error.code === 'MASTER_DATA_REFERENCE_INVALID' && error.status === 400,
    );
    app.state.masterData.zones.find(zone => zone.code === 'QC').status = 'ACTIVE';
    for (const priority of [0, 101, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => app.createTask({ title: 'Invalid priority', zone: 'QC', priority }, randomUUID()),
        error => error.code === 'TASK_PRIORITY_INVALID' && error.status === 400,
      );
    }
    const task = app.createTask({ title: 'Valid task', zone: ' QC ', priority: 73 }, randomUUID());
    await app.flush();
    const stored = (await repository.load()).tasks.find(item => item.id === task.id);
    assert.equal(stored.zone, 'QC');
    assert.equal(stored.priority, 73);
  } finally {
    await repository.close();
  }
});
