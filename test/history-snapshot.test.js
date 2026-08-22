import test from 'node:test';import assert from 'node:assert/strict';import { StoreMesh } from '../src/domain.js';

test('transaction and persistence snapshots do not deep-clone immutable audit history',()=>{
  const app=new StoreMesh(),old={id:'00000000-0000-4000-8000-000000000001',type:'OLD',payload:{large:'x'.repeat(10000)},occurredAt:'2026-01-01T00:00:00Z'},out={...old,status:'DELIVERED'};app.state.audit.push(old);app.state.outbox.push(out);
  const operational=app.operationalSnapshot(),persistence=app.persistenceSnapshot();assert.equal('audit'in operational,false);assert.equal('outbox'in operational,false);assert.equal(persistence.audit[0],old,'append-only audit rows are safely shared');assert.notEqual(persistence.outbox[0],out,'mutable delivery state is shallow-copied');assert.equal(persistence.outbox[0].payload,out.payload,'large immutable event payload is not deep-cloned');
});
