import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresRepository } from '../src/postgres-repository.js';

const pgOnly={skip:!process.env.DATABASE_URL};

test('cancelled carton scan events are physically deleted after PostgreSQL reload',pgOnly,async()=>{
  const siteCode=`CANCEL-SCAN-${Date.now()}`,repo=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode}),now=new Date().toISOString();
  const sessionId=crypto.randomUUID(),batchId=crypto.randomUUID(),unitId=crypto.randomUUID(),cartonId=crypto.randomUUID(),scanId=crypto.randomUUID();
  const masterData={
    products:[{id:crypto.randomUUID(),code:'T',name:'T',status:'ACTIVE'}],suppliers:[{id:crypto.randomUUID(),code:'S',name:'S',status:'ACTIVE'}],
    grades:[{id:crypto.randomUUID(),code:'A',name:'A',status:'ACTIVE'}],sizes:[{id:crypto.randomUUID(),code:'L',name:'L',status:'ACTIVE'}],
    zones:[{id:crypto.randomUUID(),code:'PACKAGING',name:'Packaging',status:'ACTIVE'}],packageTypes:[{id:crypto.randomUUID(),code:'CARTON',name:'Carton',status:'ACTIVE'},{id:crypto.randomUUID(),code:'POUCH',name:'Pouch',status:'ACTIVE'}]
  };
  const state={masterData,sessions:[{id:sessionId,operatorId:'packer',deviceId:'PDA-A',station:'PACKAGING',status:'ACTIVE',startedAt:now,updatedAt:now}],batches:[{id:batchId,code:`B-${siteCode}`,site:siteCode,product:'T',grade:'A',size:'L',supplier:'S',weightKg:1,zone:'PACKAGING',status:'PACKAGED',parentIds:[],createdAt:now}],packages:[{id:cartonId,code:`C-${siteCode}`,type:'CARTON',level:'CARTON',parentPackageId:null,status:'PACKING',items:[],createdAt:now},{id:unitId,code:`U-${siteCode}`,type:'POUCH',level:'UNIT',parentPackageId:cartonId,status:'READY_TO_SHIP',items:[{batchId,weightKg:1}],createdAt:now}],cartonScanEvents:[{id:scanId,packageId:cartonId,batchId,itemIdentity:`U-${siteCode}`,weightKg:1,scannedAt:now,sessionId,deviceId:'PDA-A',sequenceNo:1}],idempotency:new Map()};
  try{
    await repo.save(state);
    state.cartonScanEvents=[];state.packages[1].parentPackageId=null;state.packages[0].status='CANCELLED';
    await repo.save(state);
    const restored=await repo.load(),rows=await repo.pool.query('SELECT count(*)::int AS count FROM carton_scan_events WHERE package_id=$1',[cartonId]);
    assert.equal(restored.cartonScanEvents.length,0);assert.equal(rows.rows[0].count,0);
  }finally{
    await repo.pool.query('DELETE FROM carton_scan_events WHERE package_id IN(SELECT id FROM packages WHERE site_id=$1)',[repo.siteId]).catch(()=>{});
    await repo.pool.query('DELETE FROM package_items WHERE package_id IN(SELECT id FROM packages WHERE site_id=$1)',[repo.siteId]).catch(()=>{});
    for(const table of ['packages','batches','operational_sessions','products','suppliers','grades','sizes','zones','package_types','site_state_versions'])await repo.pool.query(`DELETE FROM ${table} WHERE site_id=$1`,[repo.siteId]).catch(()=>{});
    await repo.pool.query('DELETE FROM sites WHERE id=$1',[repo.siteId]).catch(()=>{});await repo.close();
  }
});
