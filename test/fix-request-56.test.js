import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

test('received internal transfer keeps its batchIds after real PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR56-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{
    const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;
    const session=app.openSession(crypto.randomUUID(),'TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),container=app.createContainer({capacityKg:20},crypto.randomUUID()),manifest={manifestVersion:2,nonce:crypto.randomUUID(),sourceSite:'IRAN',destinationSite:site,shipmentCode:`S-${Date.now()}`,status:'DISPATCHED',dispatchedAt:new Date().toISOString(),packages:[{packageCode:`P-${Date.now()}`,type:'CARTON',items:[{batchCode:`B-${Date.now()}`,product:'T',grade:'A',size:'L',weightKg:2}]}]};manifest.signature=app.signTransferManifest(manifest);
    const result=app.receiveInternalTransfer({sessionId:session.id,containerId:container.id,manifest,scannedPackageCodes:[manifest.packages[0].packageCode]},crypto.randomUUID());await app.flush();
    const state=await repository.load(),transfer=state.internalTransfers.find(x=>x.id===result.transfer.id);assert.deepEqual(transfer.batchIds,result.batches.map(x=>x.id));assert.ok(transfer.batchIds.length>0);assert.deepEqual(state.batches.filter(x=>x.sourceTransfer===manifest.shipmentCode).map(x=>x.id),transfer.batchIds)
  }finally{await repository.close()}
});
