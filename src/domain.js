import { randomUUID } from 'node:crypto';
const PROCESS_RULES={SORT:{status:'SORTED',zone:'SORTING'},WASH:{status:'WASHED',zone:'WASHING'},SLICE:{status:'SLICED',zone:'SLICING'},FREEZE:{status:'FROZEN',zone:'FREEZING'},FREEZE_DRY:{status:'FREEZE_DRIED',zone:'FREEZE_DRYING'},DRY:{status:'DRIED',zone:'DRYING'},MERGE:{status:'MERGED',zone:'PROCESSING'}};

export class DomainError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

export class StoreMesh {
  constructor({ site = 'IRAN', clock = () => new Date().toISOString(), repository = null, initialState = null } = {}) {
    this.site = site; this.clock = clock;
    this.repository = repository;
    this.pendingPersistence = Promise.resolve();
    this.state = initialState || repository?.load() || { sessions: [], batches: [], measurements: [], movements: [], inventoryAdjustments: [], containers: [], packages: [], shipments: [], internalTransfers: [], printJobs: [], audit: [], outbox: [], tasks: [], qualityChecks: [], configurationVersions: [], overrides: [], idempotency: new Map() };
    if (this.state instanceof Promise) throw new Error('Async repositories must be loaded before constructing StoreMesh');
    this.state.tasks ??= []; this.state.qualityChecks ??= [];
    this.state.configurationVersions ??= []; this.state.overrides ??= []; this.state.containers ??= []; this.state.internalTransfers ??= []; this.state.inventoryAdjustments ??= [];
  }
  persist() {
    if (!this.repository) return;
    if (this.repository.isAsync) {
      const snapshot = structuredClone({ ...this.state, idempotency: [...this.state.idempotency.entries()] });
      snapshot.idempotency = new Map(snapshot.idempotency);
      this.pendingPersistence = this.pendingPersistence.then(() => this.repository.save(snapshot));
    } else this.repository.save(this.state);
  }
  async flush() { await this.pendingPersistence; }
  run(key, action, fn) {
    if (!key) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required', 400);
    if (this.state.idempotency.has(key)) return this.state.idempotency.get(key);
    const result = fn(); this.state.idempotency.set(key, result); this.record(action, result.id); this.persist(); return result;
  }
  record(type, entityId, payload = {}) {
    const event = { id: randomUUID(), site: this.site, type, entityId, payload, occurredAt: this.clock() };
    this.state.audit.push(event); this.state.outbox.push({ ...event, status: 'PENDING' }); return event;
  }
  openSession(operatorId, station = 'terminal-01') {
    const session = { id: randomUUID(), site: this.site, operatorId, station, status: 'ACTIVE', startedAt: this.clock(), updatedAt: this.clock() };
    this.state.sessions.push(session); this.record('SESSION_OPENED', session.id); this.persist(); return session;
  }
  requireSession(id) {
    const s = this.state.sessions.find(x => x.id === id);
    if (!s) throw new DomainError('SESSION_NOT_FOUND', 'Session not found', 404);
    if (s.status !== 'ACTIVE') throw new DomainError('SESSION_NOT_ACTIVE', 'Session is not active', 409); return s;
  }
  updateSession(id, action) {
    const s=this.state.sessions.find(x=>x.id===id);if(!s)throw new DomainError('SESSION_NOT_FOUND','Session not found',404);
    const allowed={ACTIVE:{SUSPEND:'SUSPENDED',COMPLETE:'COMPLETED',CANCEL:'CANCELLED'},SUSPENDED:{RESUME:'ACTIVE',CANCEL:'CANCELLED'}};
    const next=allowed[s.status]?.[action];if(!next)throw new DomainError('SESSION_TRANSITION_INVALID',`Cannot ${action} a ${s.status} session`,409);
    s.status=next;s.updatedAt=this.clock();if(['COMPLETED','CANCELLED'].includes(next))s.closedAt=this.clock();this.record(`SESSION_${next}`,s.id);this.persist();return s;
  }
  receive(input, key) {
    return this.run(key, 'BATCH_RECEIVED', () => {
      this.requireSession(input.sessionId);
      if (!input.supplier || !input.product || !input.grade || !input.size) throw new DomainError('RECEIVING_FIELDS_REQUIRED', 'Supplier, product, grade and size are required', 400);
      if (!(input.weightKg > 0)) throw new DomainError('WEIGHT_INVALID', 'Weight must be greater than zero', 400);
      const batch = { id: randomUUID(), code: `B-${this.site}-${String(this.state.batches.length + 1).padStart(6,'0')}`, site: this.site, supplier: input.supplier, product: input.product, grade: input.grade, size: input.size, harvestPeriod: input.harvestPeriod ?? null, weightKg: input.weightKg, zone: 'RECEIVING', status: 'RECEIVED', parentIds: [], createdAt: this.clock() };
      this.state.batches.push(batch); this.measure(batch.id, input.weightKg, 'RECEIVING', input.sessionId);
      this.queuePrint('BATCH', batch.id, batch.code); return batch;
    });
  }
  measure(batchId, weightKg, reason, sessionId) {
    if (!(weightKg > 0)) throw new DomainError('WEIGHT_INVALID', 'Weight must be greater than zero', 400);
    const batch = this.batch(batchId); const m = { id: randomUUID(), batchId, weightKg, reason, sessionId, measuredAt: this.clock() };
    this.state.measurements.push(m); batch.weightKg = weightKg; return m;
  }
  batch(id) { const b = this.state.batches.find(x => x.id === id); if (!b) throw new DomainError('BATCH_NOT_FOUND', 'Batch not found', 404); return b; }
  move(batchId, zone, sessionId, key) {
    return this.run(key, 'BATCH_MOVED', () => { this.requireSession(sessionId); const b = this.batch(batchId); const from = b.zone; b.zone = zone; const m = { id: randomUUID(), batchId, from, to: zone, movedAt: this.clock() }; this.state.movements.push(m); return m; });
  }
  createContainer(input,key){return this.run(key,'CONTAINER_CREATED',()=>{if(!(input.capacityKg>0))throw new DomainError('CONTAINER_CAPACITY_INVALID','Container capacity must be positive',400);const c={id:randomUUID(),code:`C-${this.site}-${String(this.state.containers.length+1).padStart(6,'0')}`,type:input.type??'BASKET',capacityKg:Number(input.capacityKg),zone:input.zone??'RECEIVING',status:'AVAILABLE',batchIds:[],createdAt:this.clock()};this.state.containers.push(c);this.queuePrint('CONTAINER',c.id,c.code);return c;});}
  assignBatchToContainer(containerId,batchId,sessionId,key){return this.run(key,'BATCH_ASSIGNED_TO_CONTAINER',()=>{this.requireSession(sessionId);const c=this.state.containers.find(x=>x.id===containerId);if(!c)throw new DomainError('CONTAINER_NOT_FOUND','Container not found',404);const b=this.batch(batchId),existing=c.batchIds.map(id=>this.batch(id));if(existing.some(x=>x.product!==b.product))throw new DomainError('CONTAINER_SINGLE_PRODUCT_RULE','Container may hold only one product',409);const used=existing.reduce((n,x)=>n+x.weightKg,0);if(used+b.weightKg>c.capacityKg)throw new DomainError('CONTAINER_CAPACITY_EXCEEDED','Container capacity exceeded',409);if(b.containerId&&b.containerId!==c.id)throw new DomainError('BATCH_ALREADY_CONTAINERIZED','Batch already belongs to another container',409);if(!c.batchIds.includes(b.id))c.batchIds.push(b.id);b.containerId=c.id;b.zone=c.zone;c.status='IN_USE';return c;});}
  moveContainer(containerId,zone,sessionId,key){return this.run(key,'CONTAINER_MOVED',()=>{this.requireSession(sessionId);const c=this.state.containers.find(x=>x.id===containerId);if(!c)throw new DomainError('CONTAINER_NOT_FOUND','Container not found',404);const from=c.zone;c.zone=zone;for(const id of c.batchIds){const b=this.batch(id),batchFrom=b.zone;b.zone=zone;this.state.movements.push({id:randomUUID(),batchId:id,containerId:c.id,from:batchFrom,to:zone,movedAt:this.clock()})}return{id:randomUUID(),containerId:c.id,from,to:zone,movedAt:this.clock()};});}
  transform(input, key) {
    return this.run(key, 'BATCH_TRANSFORMED', () => {
      this.requireSession(input.sessionId);
      const rule=PROCESS_RULES[input.process];if(!rule)throw new DomainError('PROCESS_NOT_SUPPORTED','Unsupported production process',400);
      const requestedInputs = input.inputs?.length ? input.inputs : (input.parentIds ?? []).map(batchId => ({ batchId, consumeWeightKg:this.batch(batchId).weightKg }));
      if (!requestedInputs.length) throw new DomainError('PARENTS_REQUIRED','At least one input is required',400);
      const inputs = requestedInputs.map(x => ({ batch:this.batch(x.batchId), consumeWeightKg:Number(x.consumeWeightKg) }));
      for (const x of inputs) if (!(x.consumeWeightKg > 0) || x.consumeWeightKg > x.batch.weightKg) throw new DomainError('INSUFFICIENT_INVENTORY','Input exceeds available batch weight',409);
      const inputWeight = inputs.reduce((n,x)=>n+x.consumeWeightKg,0);
      if (!(input.outputWeightKg > 0) || input.outputWeightKg > inputWeight) throw new DomainError('OUTPUT_WEIGHT_INVALID','Output weight exceeds consumed input',409);
      const parents=inputs.map(x=>x.batch);
      const child = { id: randomUUID(), code:`B-${this.site}-${String(this.state.batches.length+1).padStart(6,'0')}`, site:this.site, supplier:null, product:input.product ?? parents[0].product, grade:input.grade ?? parents[0].grade, size:input.size ?? parents[0].size, weightKg:input.outputWeightKg, zone:input.zone ?? rule.zone, status:rule.status, parentIds:input.parentIds, process:input.process, createdAt:this.clock() };
      child.parentIds=parents.map(x=>x.id); child.inputWeightKg=inputWeight; child.processLossKg=inputWeight-input.outputWeightKg;
      for(const x of inputs){x.batch.weightKg=Number((x.batch.weightKg-x.consumeWeightKg).toFixed(3));if(x.batch.weightKg===0)x.batch.status='CONSUMED';}
      this.state.batches.push(child); this.measure(child.id,input.outputWeightKg,input.process,input.sessionId); this.queuePrint('BATCH',child.id,child.code); return child;
    });
  }
  sortBatch(input,key){return this.run(key,'BATCH_SORTED',()=>{this.requireSession(input.sessionId);const parent=this.batch(input.batchId),outputs=input.outputs??[];if(!outputs.length)throw new DomainError('SORT_OUTPUTS_REQUIRED','Sorting requires outputs',400);const total=outputs.reduce((n,x)=>n+Number(x.weightKg),0);if(!(total>0)||total>parent.weightKg)throw new DomainError('SORT_WEIGHT_INVALID','Sorted output exceeds available weight',409);const children=outputs.map(x=>{if(!(x.weightKg>0)||!x.grade||!x.size)throw new DomainError('SORT_OUTPUT_INVALID','Every output needs positive weight, grade and size',400);const child={id:randomUUID(),code:`B-${this.site}-${String(this.state.batches.length+1).padStart(6,'0')}`,site:this.site,supplier:null,product:parent.product,grade:x.grade,size:x.size,weightKg:Number(x.weightKg),zone:x.zone??'SORTING',status:'SORTED',parentIds:[parent.id],process:'SORT',createdAt:this.clock()};this.state.batches.push(child);this.measure(child.id,child.weightKg,'SORT',input.sessionId);this.queuePrint('BATCH',child.id,child.code);return child});parent.weightKg=Number((parent.weightKg-total).toFixed(3));if(parent.weightKg===0)parent.status='CONSUMED';return{children,remainingWeightKg:parent.weightKg,lossKg:Number(input.lossKg??0)};});}
  createPackage(input, key) {
    return this.run(key, 'PACKAGE_CREATED', () => { this.requireSession(input.sessionId); const requested=input.items??[];if(!requested.length)throw new DomainError('PACKAGE_EMPTY','Package needs items',400);const items=requested.map(x=>{const batch=this.batch(x.batchId),weightKg=Number(x.weightKg);if(!(weightKg>0)||weightKg>batch.weightKg)throw new DomainError('INSUFFICIENT_INVENTORY','Package item exceeds available batch weight',409);return{batch,weightKg}});for(const x of items){x.batch.weightKg=Number((x.batch.weightKg-x.weightKg).toFixed(3));if(x.batch.weightKg===0)x.batch.status='PACKAGED';}const p={id:randomUUID(),code:`P-${this.site}-${String(this.state.packages.length+1).padStart(6,'0')}`,type:input.type,items:items.map(x=>({batchId:x.batch.id,weightKg:x.weightKg})),status:'READY',createdAt:this.clock()}; this.state.packages.push(p); this.queuePrint('PACKAGE',p.id,p.code); return p; });
  }
  createShipment(input, key) {
    return this.run(key, 'SHIPMENT_CREATED', () => { const ids=input.packageIds ?? []; if(!ids.length) throw new DomainError('SHIPMENT_EMPTY','Shipment needs packages',400); const packages=ids.map(id=>{const p=this.state.packages.find(x=>x.id===id); if(!p) throw new DomainError('PACKAGE_NOT_FOUND','Package not found',404); if(p.shipmentId) throw new DomainError('PACKAGE_ALREADY_SHIPPED','Package already assigned',409); return p;}); const s={id:randomUUID(),code:`S-${this.site}-${String(this.state.shipments.length+1).padStart(6,'0')}`,destinationSite:input.destinationSite,packageIds:ids,status:'READY',createdAt:this.clock()}; this.state.shipments.push(s); packages.forEach(p=>p.shipmentId=s.id); return s; });
  }
  updateShipment(id, action, key){return this.run(key,`SHIPMENT_${action}`,()=>{const s=this.state.shipments.find(x=>x.id===id);if(!s)throw new DomainError('SHIPMENT_NOT_FOUND','Shipment not found',404);const allowed={READY:{LOAD:'LOADED',CANCEL:'CANCELLED'},LOADED:{DISPATCH:'DISPATCHED'},DISPATCHED:{DELIVER:'DELIVERED'}};const next=allowed[s.status]?.[action];if(!next)throw new DomainError('SHIPMENT_TRANSITION_INVALID',`Cannot ${action} a ${s.status} shipment`,409);s.status=next;s.updatedAt=this.clock();return s;});}
  shipmentManifest(id){const s=this.state.shipments.find(x=>x.id===id);if(!s)throw new DomainError('SHIPMENT_NOT_FOUND','Shipment not found',404);return{manifestVersion:1,sourceSite:this.site,destinationSite:s.destinationSite,shipmentCode:s.code,status:s.status,packages:s.packageIds.map(id=>{const p=this.state.packages.find(x=>x.id===id);return{packageCode:p.code,type:p.type,items:p.items.map(x=>{const b=this.batch(x.batchId);return{batchCode:b.code,product:b.product,grade:b.grade,size:b.size,weightKg:x.weightKg}})}})}}
  receiveInternalTransfer(input,key){return this.run(key,'INTERNAL_TRANSFER_RECEIVED',()=>{this.requireSession(input.sessionId);const m=input.manifest;if(!m||m.destinationSite!==this.site)throw new DomainError('TRANSFER_DESTINATION_MISMATCH','Manifest destination does not match this site',403);if(m.status!=='DISPATCHED'&&m.status!=='DELIVERED')throw new DomainError('TRANSFER_NOT_DISPATCHED','Only dispatched manifests may be received',409);if(this.state.internalTransfers.some(x=>x.sourceSite===m.sourceSite&&x.shipmentCode===m.shipmentCode))throw new DomainError('TRANSFER_ALREADY_RECEIVED','Transfer already received',409);const batches=[];for(const p of m.packages??[])for(const item of p.items??[]){if(!(item.weightKg>0))throw new DomainError('TRANSFER_ITEM_INVALID','Transfer item weight must be positive',400);const b={id:randomUUID(),code:`B-${this.site}-${String(this.state.batches.length+1).padStart(6,'0')}`,site:this.site,supplier:null,product:item.product,grade:item.grade,size:item.size,weightKg:Number(item.weightKg),zone:'RECEIVING',status:'RECEIVED',parentIds:[],externalParents:[{site:m.sourceSite,batchCode:item.batchCode}],sourceTransfer:m.shipmentCode,createdAt:this.clock()};this.state.batches.push(b);this.measure(b.id,b.weightKg,'INTERNAL_TRANSFER',input.sessionId);this.queuePrint('BATCH',b.id,b.code);batches.push(b)}const transfer={id:randomUUID(),sourceSite:m.sourceSite,shipmentCode:m.shipmentCode,receivedBy:input.receivedBy,manifest:structuredClone(m),batchIds:batches.map(x=>x.id),receivedAt:this.clock()};this.state.internalTransfers.push(transfer);return{transfer,batches};});}
  queuePrint(entityType,entityId,label){const j={id:randomUUID(),entityType,entityId,label,status:'PENDING',attempts:0,createdAt:this.clock()};this.state.printJobs.push(j);return j;}
  completePrint(id){const j=this.state.printJobs.find(x=>x.id===id);if(!j)throw new DomainError('PRINT_JOB_NOT_FOUND','Print job not found',404);j.status='PRINTED';j.attempts++;j.printedAt=this.clock();this.record('LABEL_PRINTED',j.entityId,{jobId:id});this.persist();return j;}
  failPrint(id,reason){const j=this.state.printJobs.find(x=>x.id===id);if(!j)throw new DomainError('PRINT_JOB_NOT_FOUND','Print job not found',404);if(j.status==='PRINTED')throw new DomainError('PRINT_ALREADY_COMPLETED','Printed job cannot fail',409);j.attempts++;j.lastError=reason;j.status=j.attempts>=3?'FAILED':'PENDING';j.updatedAt=this.clock();this.record('LABEL_PRINT_FAILED',j.entityId,{jobId:id,reason,attempts:j.attempts});this.persist();return j;}
  retryPrint(id){const j=this.state.printJobs.find(x=>x.id===id);if(!j)throw new DomainError('PRINT_JOB_NOT_FOUND','Print job not found',404);if(j.status!=='FAILED')throw new DomainError('PRINT_RETRY_INVALID','Only failed jobs can be retried',409);j.status='PENDING';j.lastError=null;j.updatedAt=this.clock();this.record('LABEL_PRINT_REQUEUED',j.entityId,{jobId:id});this.persist();return j;}
  createTask(input, key){return this.run(key,'TASK_CREATED',()=>{const task={id:randomUUID(),site:this.site,title:input.title,zone:input.zone,priority:input.priority??50,status:'OPEN',assignedTo:input.assignedTo??null,entityId:input.entityId??null,createdAt:this.clock()};this.state.tasks.push(task);return task;});}
  claimTask(id,operatorId,key){return this.run(key,'TASK_CLAIMED',()=>{const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new DomainError('TASK_NOT_FOUND','Task not found',404);if(t.status!=='OPEN')throw new DomainError('TASK_ALREADY_CLAIMED','Task is not open',409);t.status='IN_PROGRESS';t.assignedTo=operatorId;t.claimedAt=this.clock();return t;});}
  qualityCheck(input,key){return this.run(key,'QUALITY_CHECK_RECORDED',()=>{this.batch(input.batchId);if(!['APPROVED','REJECTED','QUARANTINED'].includes(input.result))throw new DomainError('QUALITY_RESULT_INVALID','Invalid quality result',400);const q={id:randomUUID(),batchId:input.batchId,result:input.result,notes:input.notes??'',inspectorId:input.inspectorId,createdAt:this.clock()};this.state.qualityChecks.push(q);if(input.result==='QUARANTINED')this.batch(input.batchId).zone='QUARANTINE';return q;});}
  releaseQuarantine(input,key){return this.run(key,'QUARANTINE_RELEASED',()=>{const b=this.batch(input.batchId);if(b.zone!=='QUARANTINE')throw new DomainError('BATCH_NOT_QUARANTINED','Batch is not quarantined',409);if(!input.reason?.trim())throw new DomainError('RELEASE_REASON_REQUIRED','Release reason is required',400);const q={id:randomUUID(),batchId:b.id,result:'APPROVED',notes:input.reason,inspectorId:input.inspectorId,createdAt:this.clock(),release:true};this.state.qualityChecks.push(q);b.zone=input.destinationZone??'COLD_ROOM';b.status='RELEASED';return q;});}
  adjustInventory(input,key){return this.run(key,'INVENTORY_ADJUSTED',()=>{const b=this.batch(input.batchId),delta=Number(input.deltaKg);if(!Number.isFinite(delta)||delta===0)throw new DomainError('ADJUSTMENT_INVALID','Adjustment must be non-zero',400);if(!input.reason?.trim())throw new DomainError('ADJUSTMENT_REASON_REQUIRED','Adjustment reason is required',400);if(b.weightKg+delta<0)throw new DomainError('INSUFFICIENT_INVENTORY','Adjustment would make inventory negative',409);const before=b.weightKg;b.weightKg=Number((before+delta).toFixed(3));if(b.weightKg===0)b.status=input.reasonCode==='WASTE'?'WASTED':'DEPLETED';if(input.reasonCode==='WASTE')b.zone='WASTE';const a={id:randomUUID(),batchId:b.id,beforeKg:before,deltaKg:delta,afterKg:b.weightKg,reasonCode:input.reasonCode??'CORRECTION',reason:input.reason,userId:input.userId,createdAt:this.clock()};this.state.inventoryAdjustments.push(a);return a;});}
  createConfiguration(input,key){return this.run(key,'CONFIGURATION_DRAFTED',()=>{const sequence=1+Math.max(0,...this.state.configurationVersions.filter(x=>x.scope===input.scope).map(x=>x.sequence));const version={id:randomUUID(),scope:input.scope,sequence,status:'DRAFT',values:structuredClone(input.values??{}),createdBy:input.userId,createdAt:this.clock()};this.state.configurationVersions.push(version);return version;});}
  transitionConfiguration(id,action,userId,key){return this.run(key,`CONFIGURATION_${action}`,()=>{const v=this.state.configurationVersions.find(x=>x.id===id);if(!v)throw new DomainError('CONFIGURATION_NOT_FOUND','Configuration version not found',404);const allowed={DRAFT:{APPROVE:'APPROVED'},APPROVED:{ACTIVATE:'ACTIVE'}};const next=allowed[v.status]?.[action];if(!next)throw new DomainError('CONFIGURATION_TRANSITION_INVALID',`Cannot ${action} ${v.status} configuration`,409);if(action==='APPROVE'&&v.createdBy===userId)throw new DomainError('SELF_APPROVAL_FORBIDDEN','Creator cannot approve own configuration',403);if(next==='ACTIVE')for(const old of this.state.configurationVersions.filter(x=>x.scope===v.scope&&x.status==='ACTIVE'))old.status='RETIRED';v.status=next;v.updatedBy=userId;v.updatedAt=this.clock();return v;});}
  requestOverride(input,key){return this.run(key,'OVERRIDE_REQUESTED',()=>{if(!input.reason?.trim())throw new DomainError('OVERRIDE_REASON_REQUIRED','Override reason is required',400);const o={id:randomUUID(),ruleCode:input.ruleCode,entityId:input.entityId,reason:input.reason,requestedBy:input.requestedBy,status:'PENDING',createdAt:this.clock()};this.state.overrides.push(o);return o;});}
  resolveOverride(id,input,key){return this.run(key,'OVERRIDE_RESOLVED',()=>{const o=this.state.overrides.find(x=>x.id===id);if(!o)throw new DomainError('OVERRIDE_NOT_FOUND','Override not found',404);if(o.status!=='PENDING')throw new DomainError('OVERRIDE_ALREADY_RESOLVED','Override already resolved',409);if(o.requestedBy===input.resolvedBy)throw new DomainError('SELF_APPROVAL_FORBIDDEN','Requester cannot resolve own override',403);if(!['APPROVED','REJECTED'].includes(input.decision))throw new DomainError('OVERRIDE_DECISION_INVALID','Decision must be APPROVED or REJECTED',400);o.status=input.decision;o.resolvedBy=input.resolvedBy;o.resolutionNote=input.note??'';o.resolvedAt=this.clock();return o;});}
  inventory(){return this.state.batches.map(b=>({id:b.id,code:b.code,product:b.product,grade:b.grade,size:b.size,weightKg:b.weightKg,zone:b.zone,containerId:b.containerId??null,status:b.status,parentIds:b.parentIds}));}
  trace(id){const root=this.batch(id);const ancestors=[];const visit=b=>{for(const pid of b.parentIds){const p=this.batch(pid);ancestors.push(p);visit(p);}};visit(root);return{batch:root,ancestors,measurements:this.state.measurements.filter(x=>x.batchId===id),movements:this.state.movements.filter(x=>x.batchId===id)};}
}
