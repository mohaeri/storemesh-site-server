import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {StoreMesh} from '../src/domain.js';
import {PostgresRepository} from '../src/postgres-repository.js';
import {AuthService} from '../src/auth.js';
import {createServer} from '../src/server.js';

const pgOnly={skip:!process.env.DATABASE_URL};
const transferKey='part-a-real-postgres-transfer-key-long-enough';

async function site(site,username,roles){
  const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  const initialState=await repository.load();
  const app=new StoreMesh({site,initialState,seedDemoReferences:true,transferManifestKey:transferKey});
  app.repository=repository;
  const auth=new AuthService({site,secret:`auth-${site}-secret`}),userId=randomUUID();
  auth.addUser({id:userId,username,password:'test-password',roles});
  const server=createServer({app,auth,requireAuth:true});server.listen(0);await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'test-password',deviceId:'TEST-DEVICE'})});
  const token=(await login.json()).data.token;
  const call=async(path,{method='POST',body,key=randomUUID()}={})=>{const response=await fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()}};
  return{app,repository,server,userId,call,async close(){server.close();await once(server,'close');await app.flush();await repository.close()}};
}

test('real PostgreSQL HTTP transfer signs, rejects tampering, requires scans, and persists JWT receiver',pgOnly,async()=>{
  const suffix=Date.now(),source=await site(`FR8A-IRAN-${suffix}`,'source',['SHIPPING_OPERATOR','PACKAGING_OPERATOR']),destination=await site(`FR8A-DUBAI-${suffix}`,'receiver',['RECEIVING_OPERATOR']);
  try{
    const sourceSession=source.app.openSession(source.userId,'TEST-DEVICE','SHIPPING','SHIPPING_OPERATOR'),container=source.app.createContainer({capacityKg:10},'container'),batch=source.app.receive({sessionId:sourceSession.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:4},'receive'),pkg=source.app.createPackage({sessionId:sourceSession.id,type:'POUCH',items:[{batchId:batch.id,weightKg:2}]},'package');
    for(const action of['PACK','SEAL','PRINT','PRINT_SUCCESS','READY'])source.app.transitionPackage(pkg.id,action,`package-${action}`);
    const shipment=source.app.createInternalShipment({packageIds:[pkg.id],destinationSite:destination.app.site},'shipment');await source.app.flush();
    const sourceHttpSession=(await source.call('/api/sessions',{body:{deviceId:'TEST-DEVICE',station:'SHIPPING',selectedRole:'SHIPPING_OPERATOR'}})).data.data;
    assert.equal((await source.call(`/api/internal-shipments/${shipment.id}/load`,{body:{}})).status,201);
    assert.equal((await source.call(`/api/internal-shipments/${shipment.id}/dispatch`,{body:{sessionId:sourceHttpSession.id,scannedPackageCodes:[]}})).status,409);
    assert.equal((await source.call(`/api/internal-shipments/${shipment.id}/dispatch`,{body:{sessionId:sourceHttpSession.id,scannedPackageCodes:[pkg.code]}})).status,201);
    const manifestResponse=await source.call(`/api/shipments/${shipment.id}/manifest`,{method:'GET'}),manifest=manifestResponse.data;
    assert.equal(manifestResponse.status,200);assert.equal(manifest.manifestVersion,2);assert.ok(manifest.signature&&manifest.nonce);
    const destinationSession=(await destination.call('/api/sessions',{body:{deviceId:'TEST-DEVICE',station:'RECEIVING',selectedRole:'RECEIVING_OPERATOR'}})).data.data;
    const tampered=structuredClone(manifest);tampered.packages[0].items[0].weightKg=200;
    assert.equal((await destination.call('/api/internal-transfers/receive',{body:{sessionId:destinationSession.id,manifest:tampered,scannedPackageCodes:[pkg.code],receivedBy:'forged-client'}})).status,403);
    assert.equal((await destination.call('/api/internal-transfers/receive',{body:{sessionId:destinationSession.id,manifest,scannedPackageCodes:[],receivedBy:'forged-client'}})).status,409);
    assert.equal((await destination.call('/api/internal-transfers/receive',{body:{sessionId:destinationSession.id,manifest,scannedPackageCodes:[pkg.code],receivedBy:'forged-client'}})).status,201);
    await destination.app.flush();const reloaded=await destination.repository.load(),transfer=reloaded.internalTransfers.find(x=>x.shipmentCode===shipment.code);
    assert.equal(transfer.receivedBy,destination.userId);assert.notEqual(transfer.receivedBy,'forged-client');assert.deepEqual(transfer.receiptScan.packageCodes,[pkg.code]);
  }finally{await source.close();await destination.close()}
});
