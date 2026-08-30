import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{StoreMesh}from'../src/domain.js';

const key=()=>randomUUID();
const setup=(ageDays=0,zone='COLD_ROOM_CLEAN')=>{let now=Date.parse('2026-08-30T12:00:00.000Z');const app=new StoreMesh({clock:()=>new Date(now).toISOString()});app.registerDevice({code:'DEVICE',type:'TERMINAL',assignedStation:'STORAGE'},key());const session=app.openSession('storage','DEVICE','STORAGE','STORAGE_OPERATOR'),batch={id:randomUUID(),code:'B-AGING',product:'T',grade:'A',size:'L',weightKg:10,zone,status:'RECEIVED',containerId:null,parentIds:[],createdAt:new Date(now-ageDays*86400000).toISOString()};app.state.batches.push(batch);return{app,batch,session,advance:days=>now+=days*86400000}};
const activate=(app,map)=>{const draft=app.createConfiguration({scope:'STORAGE',values:{agingWarningDaysByZone:map},userId:'author'},key());app.transitionConfiguration(draft.id,'APPROVE','reviewer',key());app.transitionConfiguration(draft.id,'ACTIVATE','reviewer',key())};

test('inventory exposes dwell age and raises one storage warning after the zone threshold',()=>{const{app,batch}=setup(6);activate(app,{COLD_ROOM_CLEAN:5});assert.equal(app.inventory().find(x=>x.id===batch.id).agingDays,6);assert.equal(app.inventory().find(x=>x.id===batch.id).agingWarning,true);assert.equal(app.state.exceptions.filter(x=>x.type==='STORAGE_AGING_WARNING'&&x.entityId===batch.id).length,1)});
test('within-tolerance inventory and zones without thresholds keep existing behavior',()=>{const within=setup(2);activate(within.app,{COLD_ROOM_CLEAN:5});assert.equal(within.app.inventory()[0].agingWarning,false);assert.equal(within.app.state.exceptions.length,0);const unconfigured=setup(20,'SORTING');activate(unconfigured.app,{COLD_ROOM_CLEAN:5});assert.equal(unconfigured.app.inventory()[0].agingWarning,false);assert.equal(unconfigured.app.state.exceptions.length,0)});
test('aging resets to current-zone dwell time after a move',()=>{const{app,batch,session,advance}=setup(10);app.move(batch.id,'SORTING',session.id,key());advance(2);assert.equal(app.inventory()[0].agingDays,2)});
