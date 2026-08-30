import test from'node:test';
import assert from'node:assert/strict';
import{StoreMesh}from'../src/domain.js';
import{randomUUID}from'node:crypto';

const key=()=>randomUUID();
const activateReceiving=(app,values)=>{const draft=app.createConfiguration({scope:'RECEIVING',values,userId:'author'},key());app.transitionConfiguration(draft.id,'APPROVE','reviewer',key());app.transitionConfiguration(draft.id,'ACTIVATE','reviewer',key());return draft};
const receive=(app,session,weight,expected)=>{const container=app.createContainer({capacityKg:200},key());return app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:weight,...(expected?{expectedWeightKg:expected}:{})},key())};

test('expected receiving weight raises anomaly only outside active tolerance',()=>{const app=new StoreMesh(),session=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR');activateReceiving(app,{weightVarianceLimit:.1});const outside=receive(app,session,80,100),inside=receive(app,session,91,100);assert.ok(app.state.exceptions.some(x=>x.type==='WEIGHT_ANOMALY'&&x.entityId===outside.id));assert.equal(app.state.exceptions.some(x=>x.type==='WEIGHT_ANOMALY'&&x.entityId===inside.id),false)});

test('receiving hours raise a warning outside the configured local window',()=>{let now='2026-08-30T05:00:00.000Z';const app=new StoreMesh({clock:()=>now}),outsideSession=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR');activateReceiving(app,{operatingHoursStart:'09:00',operatingHoursEnd:'17:00'});const outside=receive(app,outsideSession,5);assert.deepEqual(app.state.exceptions.filter(x=>x.type==='RECEIVING_OUTSIDE_HOURS'&&x.entityId===outside.id).map(x=>x.severity),['WARNING']);now='2026-08-30T06:00:00.000Z';const insideSession=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),inside=receive(app,insideSession,5);assert.equal(app.state.exceptions.some(x=>x.type==='RECEIVING_OUTSIDE_HOURS'&&x.entityId===inside.id),false)});

test('receiving without an hours configuration keeps existing behavior',()=>{const app=new StoreMesh({clock:()=>new Date(2026,7,30,2,0,0).toISOString()}),session=app.openSession('receiver','TEST-DEVICE','RECEIVING','RECEIVING_OPERATOR'),batch=receive(app,session,5);assert.equal(batch.status,'RECEIVED');assert.equal(app.state.exceptions.some(x=>x.type==='RECEIVING_OUTSIDE_HOURS'),false)});
