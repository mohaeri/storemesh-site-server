import { randomUUID } from 'node:crypto';

export class DomainError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}

export class StoreMesh {
  constructor({ site = 'IRAN', clock = () => new Date().toISOString(), repository = null } = {}) {
    this.site = site; this.clock = clock;
    this.repository = repository;
    this.state = repository?.load() || { sessions: [], batches: [], measurements: [], movements: [], packages: [], shipments: [], printJobs: [], audit: [], outbox: [], tasks: [], qualityChecks: [], idempotency: new Map() };
    this.state.tasks ??= []; this.state.qualityChecks ??= [];
  }
  persist() { this.repository?.save(this.state); }
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
  transform(input, key) {
    return this.run(key, 'BATCH_TRANSFORMED', () => {
      this.requireSession(input.sessionId); if (!input.parentIds?.length) throw new DomainError('PARENTS_REQUIRED','At least one parent is required',400);
      const parents = input.parentIds.map(id => this.batch(id)); const available = parents.reduce((n,b)=>n+b.weightKg,0);
      if (!(input.outputWeightKg > 0) || input.outputWeightKg > available) throw new DomainError('OUTPUT_WEIGHT_INVALID','Output weight exceeds available input',409);
      const child = { id: randomUUID(), code:`B-${this.site}-${String(this.state.batches.length+1).padStart(6,'0')}`, site:this.site, supplier:null, product:input.product ?? parents[0].product, grade:input.grade ?? parents[0].grade, size:input.size ?? parents[0].size, weightKg:input.outputWeightKg, zone:input.zone ?? 'PROCESSING', status:'PROCESSED', parentIds:input.parentIds, process:input.process, createdAt:this.clock() };
      this.state.batches.push(child); this.measure(child.id,input.outputWeightKg,input.process,input.sessionId); this.queuePrint('BATCH',child.id,child.code); return child;
    });
  }
  createPackage(input, key) {
    return this.run(key, 'PACKAGE_CREATED', () => { this.requireSession(input.sessionId); const items=input.items?.map(x=>({ batchId:this.batch(x.batchId).id, weightKg:x.weightKg })) ?? []; if(!items.length) throw new DomainError('PACKAGE_EMPTY','Package needs items',400); const p={id:randomUUID(),code:`P-${this.site}-${String(this.state.packages.length+1).padStart(6,'0')}`,type:input.type,items,status:'READY',createdAt:this.clock()}; this.state.packages.push(p); this.queuePrint('PACKAGE',p.id,p.code); return p; });
  }
  createShipment(input, key) {
    return this.run(key, 'SHIPMENT_CREATED', () => { const ids=input.packageIds ?? []; if(!ids.length) throw new DomainError('SHIPMENT_EMPTY','Shipment needs packages',400); const packages=ids.map(id=>{const p=this.state.packages.find(x=>x.id===id); if(!p) throw new DomainError('PACKAGE_NOT_FOUND','Package not found',404); if(p.shipmentId) throw new DomainError('PACKAGE_ALREADY_SHIPPED','Package already assigned',409); return p;}); const s={id:randomUUID(),code:`S-${this.site}-${String(this.state.shipments.length+1).padStart(6,'0')}`,destinationSite:input.destinationSite,packageIds:ids,status:'READY',createdAt:this.clock()}; this.state.shipments.push(s); packages.forEach(p=>p.shipmentId=s.id); return s; });
  }
  queuePrint(entityType,entityId,label){const j={id:randomUUID(),entityType,entityId,label,status:'PENDING',attempts:0,createdAt:this.clock()};this.state.printJobs.push(j);return j;}
  completePrint(id){const j=this.state.printJobs.find(x=>x.id===id);if(!j)throw new DomainError('PRINT_JOB_NOT_FOUND','Print job not found',404);j.status='PRINTED';j.attempts++;j.printedAt=this.clock();this.record('LABEL_PRINTED',j.entityId,{jobId:id});this.persist();return j;}
  createTask(input, key){return this.run(key,'TASK_CREATED',()=>{const task={id:randomUUID(),site:this.site,title:input.title,zone:input.zone,priority:input.priority??50,status:'OPEN',assignedTo:input.assignedTo??null,entityId:input.entityId??null,createdAt:this.clock()};this.state.tasks.push(task);return task;});}
  claimTask(id,operatorId,key){return this.run(key,'TASK_CLAIMED',()=>{const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new DomainError('TASK_NOT_FOUND','Task not found',404);if(t.status!=='OPEN')throw new DomainError('TASK_ALREADY_CLAIMED','Task is not open',409);t.status='IN_PROGRESS';t.assignedTo=operatorId;t.claimedAt=this.clock();return t;});}
  qualityCheck(input,key){return this.run(key,'QUALITY_CHECK_RECORDED',()=>{this.batch(input.batchId);if(!['APPROVED','REJECTED','QUARANTINED'].includes(input.result))throw new DomainError('QUALITY_RESULT_INVALID','Invalid quality result',400);const q={id:randomUUID(),batchId:input.batchId,result:input.result,notes:input.notes??'',inspectorId:input.inspectorId,createdAt:this.clock()};this.state.qualityChecks.push(q);if(input.result==='QUARANTINED')this.batch(input.batchId).zone='QUARANTINE';return q;});}
  inventory(){return this.state.batches.map(b=>({id:b.id,code:b.code,product:b.product,grade:b.grade,size:b.size,weightKg:b.weightKg,zone:b.zone,status:b.status,parentIds:b.parentIds}));}
  trace(id){const root=this.batch(id);const ancestors=[];const visit=b=>{for(const pid of b.parentIds){const p=this.batch(pid);ancestors.push(p);visit(p);}};visit(root);return{batch:root,ancestors,measurements:this.state.measurements.filter(x=>x.batchId===id),movements:this.state.movements.filter(x=>x.batchId===id)};}
}
