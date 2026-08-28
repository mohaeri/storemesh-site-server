import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreMesh } from '../src/domain.js';

test('exception lifecycle enforces assignment and terminal resolution',()=>{
  const app=new StoreMesh(),entityId=crypto.randomUUID();
  const item=app.raiseException({type:'MANUAL_DAMAGE',entityType:'BATCH',entityId,severity:'HIGH'},'raise');
  assert.equal(item.status,'OPEN');
  assert.equal(app.assignException(item.id,{assignedTo:'manager-1'},'assign').status,'ASSIGNED');
  const resolved=app.resolveException(item.id,{decision:'RESOLVED',resolvedBy:'manager-1',resolutionNote:'Inspected and isolated'},'resolve');
  assert.equal(resolved.status,'RESOLVED');
  assert.throws(()=>app.assignException(item.id,{assignedTo:'operator-2'},'reassign'),e=>e.code==='EXCEPTION_ASSIGNMENT_INVALID');
});

test('capacity rejection raises a durable operational exception',()=>{
  const app=new StoreMesh(),session=app.openSession('operator','device-1'),container=app.createContainer({capacityKg:1},'container');
  assert.throws(()=>app.receive({sessionId:session.id,containerId:container.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:2},'receive'),e=>e.code==='CONTAINER_CAPACITY_EXCEEDED');
  assert.equal(app.state.exceptions.at(-1).type,'CAPACITY_EXCEEDED');
  assert.equal(app.state.exceptions.at(-1).status,'OPEN');
});

test('FIFO deviation, quarantine and equipment failure raise exceptions',()=>{
  let tick=0;const app=new StoreMesh({clock:()=>new Date(1700000000000+tick++*1000).toISOString()}),session=app.openSession('operator','device-1');
  const receive=(key)=>{const c=app.createContainer({capacityKg:10},`c-${key}`);const b=app.receive({sessionId:session.id,containerId:c.id,supplier:'S',product:'T',grade:'A',size:'L',weightKg:2},key);c.batchIds=[];b.containerId=null;return b};
  const oldest=receive('old'),newer=receive('new');app.move(oldest.id,'COLD_ROOM_CLEAN',session.id,'move-old');app.move(newer.id,'COLD_ROOM_CLEAN',session.id,'move-new');
  app.move(newer.id,'SORTING',session.id,'fifo');
  const tray=app.createContainer({type:'TRAY',capacityKg:10},'tray');app.assignBatchToContainer(tray.id,newer.id,session.id,'tray-assign');
  const checklist=app.createQcChecklist({code:'QC-T',product:oldest.product,stage:'RECEIVING',name:'QC',items:[{code:'VISUAL',prompt:'Visual pass'}]},'checklist');
  app.qualityCheck({batchId:oldest.id,stage:'RECEIVING',checklistId:checklist.id,responses:[{itemCode:'VISUAL',value:false}],attestation:{confirmed:true,role:'QUALITY_OPERATOR'},actorRoles:['QUALITY_OPERATOR'],result:'QUARANTINED',inspectorId:'qc'},'qc');
  newer.status='SLICED';newer.zone='FREEZING';tray.status='SLICED';tray.zone='FREEZING';tray.activeSessionId=null;
  const cycle=app.createCycle({sessionId:session.id,type:'FREEZE',machineId:'freezer-1',trayIds:[tray.id]},'cycle');
  app.transitionCycle(cycle.id,'START',{sessionId:session.id},'start');app.transitionCycle(cycle.id,'FAIL',{sessionId:session.id,reason:'power'},'fail');
  const types=new Set(app.state.exceptions.map(x=>x.type));
  for(const required of ['FIFO_DEVIATION','QUALITY_QUARANTINE','EQUIPMENT_CYCLE_FAILURE'])assert.equal(types.has(required),true);
});
