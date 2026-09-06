import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StoreMesh } from '../src/domain.js';
import { PostgresRepository } from '../src/postgres-repository.js';

const key=()=>randomUUID();
const activate=(app,fieldsByType,extra={})=>{const version=app.createConfiguration({scope:'LABEL',values:{fieldsByType,allowedReprintReasons:['OTHER'],reprintApprovalByType:{BASKET:false,CARTON:true},reprintThreshold:1,...extra},userId:'author'},key());app.transitionConfiguration(version.id,'APPROVE','reviewer',key());app.transitionConfiguration(version.id,'ACTIVATE','reviewer',key());return version};
const activatePrinting=(app)=>{const version=app.createConfiguration({scope:'PRINTING',values:{reprintThreshold:1,reprintApprovalByType:{BASKET:false,CARTON:true}},userId:'author'},key());app.transitionConfiguration(version.id,'APPROVE','reviewer',key());app.transitionConfiguration(version.id,'ACTIVATE','reviewer',key())};

test('per-site label fields and reprint rules fail closed and persist in real PostgreSQL',{skip:!process.env.DATABASE_URL},async()=>{
  const repositories=['DUBAI','ROME'].map(name=>new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR118-${name}-${Date.now()}`}));
  try{
    const apps=[];for(const repository of repositories){const app=new StoreMesh({site:repository.siteCode,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;app.requireExplicitLabelConfiguration=true;apps.push(app)}
    const unconfigured=apps[0],basket=unconfigured.createContainer({capacityKg:10},key());
    assert.throws(()=>unconfigured.requestContainerLabel(basket.id,key()),error=>error.code==='LABEL_CONFIGURATION_NOT_CONFIGURED'&&error.status===409);
    activatePrinting(apps[0]);
    activate(apps[0],{CARTON:['BARCODE','QR_TRACEABILITY','WEIGHT'],BASKET:['BARCODE','CONTAINER_TYPE']},{reprintThreshold:3});
    activate(apps[1],{CARTON:['BARCODE','WEIGHT'],BASKET:['BARCODE']});
    const payloads=[];
    for(const app of apps){const pkg={id:key(),code:`P-${app.site}-000001`,type:'CARTON',level:'CARTON',status:'LABEL_PRINTED',items:[],childPackageIds:[],createdAt:'2026-09-06T00:00:00.000Z'};app.state.packages.push(pkg);const job=app.queuePrint('PACKAGE',pkg.id,pkg.code),label=app.enrichPackageLabel(pkg,app.state.labels.find(item=>item.id===job.labelId));label.status='PRINTED';payloads.push(structuredClone(label.payload));assert.throws(()=>app.reprintLabel({objectType:'CARTON',objectId:pkg.id,reasonCode:'PAPER_FINISHED'},key()),error=>error.code==='LABEL_REPRINT_REASON_NOT_ALLOWED');assert.equal(app.reprintLabel({objectType:'CARTON',objectId:pkg.id,reasonCode:'OTHER'},key()).printJob.reprintReasonCode,'OTHER');app.persist();await app.flush()}
    assert.equal(apps[0].state.exceptions.some(item=>item.type==='EXCESSIVE_REPRINT_COUNT'),false);
    apps[0].reprintLabel({objectType:'CARTON',objectId:apps[0].state.packages.at(-1).id,reasonCode:'OTHER'},key());
    apps[0].reprintLabel({objectType:'CARTON',objectId:apps[0].state.packages.at(-1).id,reasonCode:'OTHER'},key());
    assert.equal(apps[0].state.exceptions.some(item=>item.type==='EXCESSIVE_REPRINT_COUNT'),true);
    assert.equal(payloads[0].qrTraceabilityCode,`P-${apps[0].site}-000001`);
    assert.equal(payloads[1].qrTraceabilityCode,undefined);
    for(let index=0;index<repositories.length;index++){const restored=await repositories[index].load(),label=restored.labels.find(item=>item.entityType==='PACKAGE');assert.deepEqual(label.payload,payloads[index])}
  }finally{await Promise.all(repositories.map(repository=>repository.close()))}
});
