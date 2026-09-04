import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{StoreMesh}from'../src/domain.js';
import{PostgresRepository}from'../src/postgres-repository.js';

const key=()=>randomUUID();
const activate=(app,values)=>{const draft=app.createConfiguration({scope:'PACKAGING',values,userId:'author'},key());app.transitionConfiguration(draft.id,'APPROVE','reviewer',key());app.transitionConfiguration(draft.id,'ACTIVATE','reviewer',key())};
const fixture=app=>{if(!app.state.devices.some(x=>x.code==='PDA-PACK-01'))app.registerDevice({code:'PDA-PACK-01',type:'PDA',assignedStation:'PACKAGING'},key());const session=app.openSession('packer','PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR'),container=app.createContainer({capacityKg:20},key()),batch=app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:10},key());batch.status='DRIED';app.weighForPackaging({sessionId:session.id,batchId:batch.id,weightKg:10},key());return{session,batch}};
const create=(app,session,batch,weight,keyValue)=>app.createPackage({sessionId:session.id,type:'POUCH',level:'UNIT',items:[{batchId:batch.id,weightKg:weight}],targetWeightKg:weight,tolerancePercent:999},keyValue);

test('UNIT tolerance is fail-closed and configured behavior persists in PostgreSQL',{skip:!process.env.DATABASE_URL},async()=>{const repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:`FR91-${Date.now()}`});try{const app=new StoreMesh({initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;const unconfigured=fixture(app);assert.throws(()=>create(app,unconfigured.session,unconfigured.batch,5,key()),error=>error.code==='PACKAGING_TOLERANCE_NOT_CONFIGURED'&&error.status===409);activate(app,{targetWeightKg:1,weightTolerancePercent:2});const configured=fixture(app),inside=create(app,configured.session,configured.batch,1.01,key());assert.equal(inside.targetWeightKg,1);assert.equal(inside.tolerancePercent,2);assert.throws(()=>create(app,configured.session,configured.batch,1.03,key()),error=>error.code==='PACKAGE_WEIGHT_OUT_OF_TOLERANCE');await app.flush();assert.equal((await repository.load()).packages.length,1)}finally{await repository.close()}});
