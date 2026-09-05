import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { StoreMesh } from '../src/domain.js';
import { AuthService } from '../src/auth.js';
import { createServer } from '../src/server.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();
function fixture(app=new StoreMesh()){
  const session=app.openSession('operator','TEST-DEVICE','PACKAGING','PACKAGING_OPERATOR');
  const defaultPrinter=app.registerDevice({code:`PRINTER-${key()}`,type:'PRINTER',assignedStation:'PACKAGING'},key());
  const alternatePrinter=app.registerDevice({code:`PRINTER-${key()}`,type:'PRINTER',assignedStation:'SHIPPING'},key());
  const basket=app.createContainer({capacityKg:10,type:'BASKET'},key());
  const first=app.queuePrint('CONTAINER',basket.id,basket.code,{sessionId:session.id});
  app.claimPrint(first.id,session.id);app.completePrint(first.id,session.id);
  return{app,session,defaultPrinter,alternatePrinter,basket,first};
}

test('completed basket label reprints by code with the same identity and monotonic counter',()=>{
  const{app,session,basket,first}=fixture();
  const one=app.reprintLabel({objectType:'BASKET',objectId:basket.code,reasonCode:'DAMAGED_LABEL',sessionId:session.id},key());
  const two=app.reprintLabel({objectType:'BASKET',objectId:basket.id,reasonCode:'LOST_LABEL',sessionId:session.id},key());
  assert.equal(one.printJob.label,first.label);assert.equal(two.printJob.label,first.label);
  assert.equal(one.reprintCount,1);assert.equal(two.reprintCount,2);
  assert.equal(app.state.labels.filter(x=>x.entityId===basket.id).length,1);
});

test('reprint reason is fixed and original-label absence is distinct',()=>{
  const{app,session}=fixture(),tray=app.createContainer({capacityKg:5,type:'TRAY'},key());
  assert.throws(()=>app.reprintLabel({objectType:'TRAY',objectId:tray.code,reasonCode:'BECAUSE',sessionId:session.id},key()),e=>e.code==='LABEL_REPRINT_REASON_INVALID');
  assert.throws(()=>app.reprintLabel({objectType:'TRAY',objectId:tray.code,reasonCode:'OTHER',sessionId:session.id},key()),e=>e.code==='ORIGINAL_LABEL_MISSING');
});

test('default printer is resolved and a one-job override is retained separately',()=>{
  const{app,session,defaultPrinter,alternatePrinter,basket}=fixture();
  const{printJob}=app.reprintLabel({objectType:'BASKET',objectId:basket.code,reasonCode:'POOR_PRINT_QUALITY',sessionId:session.id},key());
  assert.equal(printJob.defaultPrinterId,defaultPrinter.id);assert.equal(printJob.selectedPrinterId,defaultPrinter.id);assert.equal(printJob.printerOverride,false);
  app.overridePrintPrinter(printJob.id,alternatePrinter.id,session.id,key());
  assert.equal(printJob.defaultPrinterId,defaultPrinter.id);assert.equal(printJob.selectedPrinterId,alternatePrinter.id);assert.equal(printJob.printerOverride,true);
});

test('search reprints share the excessive-reprint warning without blocking',()=>{
  const{app,session,basket}=fixture();app.state.configurationVersions.push({id:key(),scope:'PRINTING',status:'ACTIVE',values:{reprintThreshold:1}});
  app.reprintLabel({objectType:'BASKET',objectId:basket.code,reasonCode:'PAPER_FINISHED',sessionId:session.id},key());
  const result=app.reprintLabel({objectType:'BASKET',objectId:basket.code,reasonCode:'RIBBON_FINISHED',sessionId:session.id},key());
  assert.equal(result.printJob.status,'PENDING');assert.equal(app.state.exceptions.filter(x=>x.type==='EXCESSIVE_REPRINT_COUNT').length,1);
});

test('HTTP permits operator container reprint but manager-gates carton reprint',async()=>{
  const{app,session,basket}=fixture(),carton={id:key(),code:'CT-REPRINT',type:'CARTON',level:'CARTON',status:'LABEL_PRINTED',items:[],childPackageIds:[],createdAt:new Date().toISOString()};app.state.packages.push(carton);app.state.labels.push({id:key(),entityType:'PACKAGE',entityId:carton.id,identity:carton.code,payload:{identity:carton.code},status:'PRINTED',createdAt:new Date().toISOString()});
  const auth=new AuthService({secret:'fr52'});auth.addUser({id:'operator',username:'operator',password:'right',roles:['PACKAGING_OPERATOR']});auth.addUser({id:'manager',username:'manager',password:'right',roles:['MANAGER']});const server=createServer({app,auth});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const token=async username=>{const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'right',deviceId:'TEST-DEVICE'})});return(await r.json()).data.token},post=async(t,body)=>fetch(`${base}/api/labels/reprint`,{method:'POST',headers:{authorization:`Bearer ${t}`,'content-type':'application/json','idempotency-key':key()},body:JSON.stringify(body)});
  try{const operator=await token('operator'),manager=await token('manager');assert.equal((await post(operator,{objectType:'BASKET',objectId:basket.code,reasonCode:'OTHER',sessionId:session.id})).status,201);assert.equal((await post(operator,{objectType:'CARTON',objectId:carton.code,reasonCode:'OTHER',sessionId:session.id})).status,403);assert.equal((await post(manager,{objectType:'CARTON',objectId:carton.code,reasonCode:'OTHER',sessionId:session.id})).status,201)}finally{server.close();await once(server,'close')}
});

test('reprint reason and printer routing survive real PostgreSQL reload',{skip:!process.env.DATABASE_URL},async()=>{
  const site=`FR52-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});
  try{const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;const{session,basket,alternatePrinter}=fixture(app),result=app.reprintLabel({objectType:'BASKET',objectId:basket.code,reasonCode:'CUSTOMER_REQUEST',sessionId:session.id},key());app.overridePrintPrinter(result.printJob.id,alternatePrinter.id,session.id,key());await app.flush();const restored=await repository.load(),attempt=restored.printAttempts.find(x=>x.id===result.printJob.id);assert.equal(attempt.reprintReasonCode,'CUSTOMER_REQUEST');assert.equal(attempt.selectedPrinterId,alternatePrinter.id);assert.equal(attempt.printerOverride,true)}finally{await repository.close()}
});
