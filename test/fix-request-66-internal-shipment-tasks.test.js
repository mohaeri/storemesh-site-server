import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';

const key = () => randomUUID();

function fixture(packageCount = 2) {
  const app = new StoreMesh();
  const session = app.openSession('loader', 'TEST-DEVICE', 'SHIPPING', 'SHIPPING_OPERATOR');
  const packages = [];
  for (let index = 0; index < packageCount; index++) {
    const container = app.createContainer({ capacityKg: 20 }, key());
    const batch = app.receive({ sessionId: session.id, containerId: container.id, supplier: 'S', product: 'T', grade: 'A', size: 'L', weightKg: 8 }, key());
    const pkg = app.createPackage({ sessionId: session.id, type: 'POUCH', items: [{ batchId: batch.id, weightKg: 2 }] }, key());
    for (const action of ['PACK', 'SEAL', 'PRINT', 'PRINT_SUCCESS', 'READY']) app.transitionPackage(pkg.id, action, key());
    app.state.qualityChecks.push({ id: key(), batchId: batch.id, result: 'APPROVED', notes: '', createdAt: app.clock() });
    packages.push(pkg);
  }
  const shipment = app.createInternalShipment({ destinationSite: 'DUBAI', packageIds: packages.map(pkg => pkg.id) }, key());
  const tasks = app.state.tasks.filter(task => packages.some(pkg => pkg.id === task.entityId));
  return { app, session, packages, shipment, tasks };
}

test('internal shipment creates one shipping pick task per reserved package', () => {
  const { packages, tasks } = fixture();
  assert.equal(tasks.length, packages.length);
  for (const [index, task] of tasks.entries()) {
    assert.equal(task.status, 'OPEN');
    assert.equal(task.requiredRole, 'SHIPPING_OPERATOR');
    assert.equal(task.zone, 'SHIPPING');
    assert.equal(task.operationType, 'INTERNAL_SHIPMENT_DISPATCH');
    assert.equal(task.title, `Pick ${packages[index].code}`);
  }
});

for (const initialStatus of ['READY', 'LOADED']) test(`cancelling a ${initialStatus} internal shipment completes its picking tasks`, () => {
  const { app, session, shipment, tasks } = fixture(1);
  if (initialStatus === 'LOADED') app.updateInternalShipment(shipment.id, 'LOAD', { sessionId: session.id, vehicle: 'TRUCK-1' }, key());
  app.updateInternalShipment(shipment.id, 'CANCEL', { sessionId: session.id, reason: 'Route withdrawn' }, key());
  assert.equal(tasks[0].status, 'COMPLETED');
  assert.equal(tasks[0].completionNote, 'Internal shipment cancelled: Route withdrawn');
  assert.equal(tasks[0].stateHistory.at(-1).action, 'AUTO_INTERNAL_SHIPMENT_CANCEL');
});

test('dispatching an internal shipment auto-completes every picking task', () => {
  const { app, session, packages, shipment, tasks } = fixture();
  app.updateInternalShipment(shipment.id, 'LOAD', { sessionId: session.id, vehicle: 'TRUCK-1' }, key());
  app.updateInternalShipment(shipment.id, 'DISPATCH', { sessionId: session.id, scannedPackageCodes: packages.map(pkg => pkg.code) }, key());
  assert.ok(tasks.every(task => task.status === 'COMPLETED'));
  assert.ok(tasks.every(task => task.stateHistory.at(-1).action === 'AUTO_INTERNAL_SHIPMENT_DISPATCH'));
});
