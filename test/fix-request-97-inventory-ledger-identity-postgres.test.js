import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();

test('inventory ledger snapshots trusted operator identity unit and movement type immutably',{skip:!process.env.DATABASE_URL},async()=>{
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR97-${Date.now()}`});
  try{
    const app=new StoreMesh({initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    const session=app.openSession('trusted-operator','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),container=app.createContainer({capacityKg:20},key());
    const batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:6,userId:'spoofed-client'},key());
    const entry=app.inventoryLedger('BATCH',batch.id)[0];
    assert.deepEqual({userId:entry.userId,unit:entry.unit,movementType:entry.movementType,sessionId:entry.sessionId,deviceId:entry.deviceId},{userId:'trusted-operator',unit:'KG',movementType:'BATCH_RECEIVED',sessionId:session.id,deviceId:'TEST-DEVICE'});
    await app.flush();
    const restored=(await repository.load()).inventoryLedger.find(x=>x.id===entry.id);
    assert.deepEqual({userId:restored.userId,unit:restored.unit,movementType:restored.movementType},{userId:'trusted-operator',unit:'KG',movementType:'BATCH_RECEIVED'});
    await assert.rejects(repository.pool.query('UPDATE inventory_ledger SET user_id=$2 WHERE id=$1',[entry.id,'tampered']),error=>error.code==='55000');
    await assert.rejects(repository.pool.query('DELETE FROM inventory_ledger WHERE id=$1',[entry.id]),error=>error.code==='55000');
  }finally{await repository.close()}
});
