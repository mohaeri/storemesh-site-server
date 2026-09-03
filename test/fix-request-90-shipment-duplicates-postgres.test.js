import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

test('customer shipment rejects duplicate carton and box IDs before lookup and persists a unique request', { skip: !process.env.DATABASE_URL }, async () => {
  const site = `FR90-${Date.now()}`;
  const repository = new PostgresRepository({ connectionString: process.env.DATABASE_URL, siteCode: site });
  try {
    const app = new StoreMesh({ site, initialState: await repository.load(), seedDemoReferences: true });
    app.repository = repository;
    const session = app.openSession('shipper', 'PDA-PACK-01', 'PACKAGING', 'PACKAGING_OPERATOR');
    app.state.consumables.push({ id: randomUUID(), code: 'CARTON', name: 'Carton', unit: 'EA', quantity: 2, reorderThreshold: 0, status: 'ACTIVE', createdAt: new Date().toISOString() });
    const container = app.createContainer({ capacityKg: 20 }, randomUUID());
    const batch = app.receive({ sessionId: session.id, containerId: container.id, supplier: 'S', product: 'T', grade: 'A', size: 'L', weightKg: 5 }, randomUUID());
    batch.status = 'DRIED';
    app.weighForPackaging({ sessionId: session.id, batchId: batch.id, weightKg: 5 }, randomUUID());
    app.state.qualityChecks.push({ id: randomUUID(), batchId: batch.id, result: 'APPROVED', notes: '', createdAt: new Date().toISOString() });
    const unit = app.createPackage({ sessionId: session.id, type: 'POUCH', level: 'UNIT', items: [{ batchId: batch.id, weightKg: 1 }], targetWeightKg: 1, tolerancePercent: 0 }, randomUUID());
    for (const action of ['PACK', 'SEAL', 'PRINT', 'PRINT_SUCCESS', 'READY']) app.transitionPackage(unit.id, action, randomUUID());
    const carton = app.createPackage({ sessionId: session.id, type: 'CARTON', level: 'CARTON' }, randomUUID());
    app.transitionPackage(carton.id, 'PACK', randomUUID());
    app.scanPackageItem(carton.id, { sessionId: session.id, unitPackageCode: unit.code }, randomUUID());
    for (const action of ['SEAL', 'PRINT', 'PRINT_SUCCESS', 'READY']) app.transitionPackage(carton.id, action, randomUUID());
    const customer = app.createCustomer({ code: 'FR90-CUSTOMER', name: 'Customer' }, randomUUID());
    const order = app.createSalesOrder({ customerId: customer.id, items: [{ packageType: 'CARTON', quantity: 1 }] }, randomUUID());
    assert.throws(() => app.createShipment({ salesOrderId: order.id, packageIds: [carton.id, carton.id] }, randomUUID()), error => error.code === 'SHIPMENT_CARTON_DUPLICATE' && error.status === 409);
    const missingBox = randomUUID();
    assert.throws(() => app.createShipment({ salesOrderId: order.id, shippingBoxIds: [missingBox, missingBox] }, randomUUID()), error => error.code === 'SHIPMENT_BOX_DUPLICATE' && error.status === 409);
    assert.equal(app.state.shipments.length, 0);
    const shipment = app.createShipment({ salesOrderId: order.id, packageIds: [carton.id] }, randomUUID());
    await app.flush();
    const stored = (await repository.load()).shipments.find(item => item.id === shipment.id);
    assert.deepEqual(stored.packageIds, [carton.id]);
    assert.deepEqual(stored.shippingBoxIds, []);
  } finally {
    await repository.close();
  }
});
