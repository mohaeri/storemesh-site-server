import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{StoreMesh}from'../src/domain.js';
import{PostgresRepository}from'../src/postgres-repository.js';

const key=()=>randomUUID();
function fixture(app=new StoreMesh()){const session=app.openSession('packer','PDA-PACK-01','PACKAGING','PACKAGING_OPERATOR'),stock=app.createConsumable({code:'CARTON',name:'Carton',reorderThreshold:1},key());app.receiveConsumable(stock.id,{quantity:2,source:'supplier'},key());const carton=app.createPackage({sessionId:session.id,type:'CARTON',level:'CARTON'},key());return{app,stock,carton}}

test('cancelling an unused carton restores stock and persists its reversal',{skip:!process.env.DATABASE_URL},async()=>{const site=`FR83-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});try{const f=fixture(new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true}));f.app.repository=repository;assert.equal(f.stock.quantity,1);const shortage=f.app.raiseExceptionRecord({type:'CONSUMABLE_SHORTAGE',entityType:'CONSUMABLE',entityId:f.stock.id,severity:'HIGH'});f.app.transitionPackage(f.carton.id,'CANCEL',key(),{reason:'unused carton'});assert.equal(f.stock.quantity,2);assert.equal(shortage.status,'RESOLVED');const reversal=f.app.state.consumableTransactions.find(x=>x.entityId===f.carton.id&&x.type==='REVERSAL');assert.equal(reversal.reason,'CARTON_CANCELLED');assert.equal(reversal.quantity,1);await f.app.flush();const restored=await repository.load(),saved=restored.consumableTransactions.find(x=>x.id===reversal.id);assert.equal(restored.consumables.find(x=>x.id===f.stock.id).quantity,2);assert.equal(restored.exceptions.find(x=>x.id===shortage.id).status,'RESOLVED');assert.equal(saved.entityId,f.carton.id);assert.equal(saved.reason,'CARTON_CANCELLED')}finally{await repository.close()}});

test('damaging a carton does not restore physically consumed stock',()=>{const f=fixture();assert.equal(f.stock.quantity,1);f.app.transitionPackage(f.carton.id,'PACK',key());f.app.transitionPackage(f.carton.id,'DAMAGE',key(),{reason:'crushed carton'});assert.equal(f.stock.quantity,1);assert.equal(f.app.state.consumableTransactions.some(x=>x.entityId===f.carton.id&&x.type==='REVERSAL'),false)});
