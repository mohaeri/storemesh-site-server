import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { StoreMesh, DomainError } from './domain.js';
import { AuthService, PostgresAuthStore, authRequiredFromEnvironment, authorized } from './auth.js';
import { JsonRepository } from './persistence.js';
import { PostgresRepository } from './postgres-repository.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { errorResponse } from './errors.js';
export const BOOTSTRAP_ADMIN_ID='00000000-0000-4000-a000-000000000001',BOOTSTRAP_OPERATOR_ID='00000000-0000-4000-a000-000000000002';

export function createServer({ app = new StoreMesh({ site: process.env.SITE_CODE || 'IRAN', repository: process.env.DATA_FILE ? new JsonRepository(process.env.DATA_FILE) : null }), auth = null, requireAuth = true } = {}) {
  auth ??= new AuthService({ site: app.site });
  if (!auth.users.size) {
    const demoAllowed=process.env.NODE_ENV!=='production'&&process.env.ALLOW_DEMO_CREDENTIALS!=='false';
    if(!demoAllowed&&(!process.env.BOOTSTRAP_ADMIN_USER||!process.env.BOOTSTRAP_ADMIN_PASSWORD))throw new Error('Production bootstrap credentials are required');
    auth.addUser({ id:BOOTSTRAP_ADMIN_ID, username:process.env.BOOTSTRAP_ADMIN_USER||'admin', password:process.env.BOOTSTRAP_ADMIN_PASSWORD||'storemesh-demo', roles:['ADMIN'] });
    if(demoAllowed)auth.addUser({ id:BOOTSTRAP_OPERATOR_ID, username:'operator', password:'operator-demo', roles:['RECEIVING_OPERATOR','STORAGE_OPERATOR','SORTING_OPERATOR','WASHING_OPERATOR','SLICING_OPERATOR','FREEZING_OPERATOR','DRYING_OPERATOR','PACKAGING_OPERATOR','SHIPPING_OPERATOR'] });
  }
  const stats={requests:0,errors:0,startedAt:Date.now()};
  const server=http.createServer(async (req,res)=>{
    const auditContext={requestId:String(req.headers['x-request-id']??randomUUID()),ipAddress:String(req.headers['x-forwarded-for']??req.socket.remoteAddress??'').split(',')[0].trim()||null,userId:null,deviceId:null};
    return app.withAuditContext(auditContext,async()=>{
    stats.requests++;
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Idempotency-Key,Authorization,X-Request-Id'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('X-Request-Id',auditContext.requestId);
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const body=async()=>{let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{};};
    try {
      const u=new URL(req.url,'http://localhost'); const key=req.headers['idempotency-key']; let result;
      if(req.method==='GET'&&u.pathname==='/health') return send(200,{status:'ok',site:app.site});
      if(req.method==='GET'&&u.pathname==='/ready'){try{if(app.repository?.ready)await app.repository.ready();return send(200,{status:'ready',site:app.site})}catch{return send(503,{status:'not_ready',site:app.site})}}
      if(req.method==='GET'&&u.pathname==='/metrics'){res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4'});return res.end([`storemesh_http_requests_total ${stats.requests}`,`storemesh_http_errors_total ${stats.errors}`,`storemesh_uptime_seconds ${Math.floor((Date.now()-stats.startedAt)/1000)}`,`storemesh_batches ${app.state.batches.length}`,`storemesh_outbox_pending ${app.state.outbox.filter(x=>x.status==='PENDING').length}`,`storemesh_print_jobs_pending ${app.state.printJobs.filter(x=>x.status==='PENDING').length}`].join('\n')+'\n')}
      if(req.method==='POST'&&u.pathname==='/api/auth/login'){const b=await body();auditContext.deviceId=b.deviceId??null;const token=auth.login(b.username,b.password,b.deviceId),account=auth.users.get(b.username);await auth.flush();auditContext.userId=token?account.id:null;app.record(token?'LOGIN_SUCCEEDED':'LOGIN_FAILED',account?.id??null,{username:b.username},null,b.deviceId??null,token?'SUCCESS':'FAILURE');app.persist();await app.flush();return token?send(200,{success:true,data:{token}}):send(401,{success:false,errorCode:'INVALID_CREDENTIALS',message:'Invalid credentials'});}
      const user=auth.verify(req.headers.authorization?.replace(/^Bearer /,''));
      auditContext.userId=user?.sub??null;auditContext.deviceId=user?.deviceId??null;
      if(requireAuth&&!user)return send(401,{success:false,errorCode:'AUTHENTICATION_REQUIRED',message:'Authentication required'});
      const needs=permission=>{if(requireAuth&&!authorized(user,permission))throw new DomainError('FORBIDDEN','Insufficient permission',403);};
      if(req.method==='POST'&&/^\/api\/auth\/sessions\/[^/]+\/revoke$/.test(u.pathname)){needs('session:revoke');const sessionId=u.pathname.split('/')[4];if(!auth.revokeSession(sessionId,user.sub))throw new DomainError('AUTH_SESSION_NOT_FOUND','Authentication session not found',404);await auth.flush();app.record('AUTH_SESSION_REVOKED',sessionId,{},null,user.deviceId,'SUCCESS');app.persist();await app.flush();return send(200,{success:true,data:{id:sessionId,status:'REVOKED'}});}
      if(req.method==='GET'&&u.pathname==='/api/tasks'){needs('inventory:read');return send(200,{items:app.state.tasks});}
      if(req.method==='GET'&&u.pathname==='/api/exceptions'){needs('inventory:read');return send(200,{items:app.state.exceptions});}
      if(req.method==='GET'&&/^\/api\/master-data\/(products|suppliers|grades|sizes|zones|packageTypes)$/.test(u.pathname)){needs('inventory:read');return send(200,{items:app.state.masterData[u.pathname.split('/')[3]]});}
      if(req.method==='GET'&&u.pathname==='/api/containers'){needs('inventory:read');return send(200,{items:app.state.containers});}
      if(req.method==='GET'&&u.pathname==='/api/configurations'){needs('inventory:read');return send(200,{items:app.state.configurationVersions});}
      if(req.method==='GET'&&u.pathname==='/api/overrides'){needs('inventory:read');return send(200,{items:app.state.overrides});}
      if(req.method==='GET'&&u.pathname==='/api/inventory'){needs('inventory:read');return send(200,{items:app.inventory()});}
      if(req.method==='GET'&&u.pathname==='/api/print-jobs'){needs('inventory:read');return send(200,{items:app.state.printJobs});}
      if(req.method==='GET'&&u.pathname==='/api/outbox'){needs('audit:read');return send(200,{items:app.state.outbox});}
      if(req.method==='GET'&&u.pathname==='/api/sessions'){needs('inventory:read');return send(200,{items:app.state.sessions});}
      if(req.method==='GET'&&u.pathname==='/api/packages'){needs('inventory:read');return send(200,{items:app.state.packages});}
      if(req.method==='GET'&&u.pathname==='/api/cycles'){needs('inventory:read');return send(200,{items:app.state.cycles});}
      if(req.method==='GET'&&u.pathname==='/api/shipments'){needs('inventory:read');return send(200,{items:app.state.shipments});}
      if(req.method==='GET'&&u.pathname==='/api/quality-checks'){needs('inventory:read');return send(200,{items:app.state.qualityChecks});}
      if(req.method==='GET'&&u.pathname==='/api/inventory-adjustments'){needs('inventory:read');return send(200,{items:app.state.inventoryAdjustments});}
      if(req.method==='GET'&&u.pathname==='/api/audit'){needs('audit:read');return send(200,{items:app.state.audit});}
      if(req.method==='GET'&&u.pathname==='/api/internal-transfers'){needs('inventory:read');return send(200,{items:app.state.internalTransfers});}
      if(req.method==='GET'&&/^\/api\/shipments\/[^/]+\/manifest$/.test(u.pathname))return send(200,app.shipmentManifest(u.pathname.split('/')[3]));
      if(req.method==='GET'&&u.pathname.startsWith('/api/trace/')) return send(200,app.trace(u.pathname.split('/').at(-1)));
      if(req.method==='POST'&&u.pathname==='/api/sessions'){needs('operations:write');const b=await body();result=app.openSession(b.operatorId,b.deviceId,b.station);}
      else if(req.method==='POST'&&/^\/api\/master-data\/(products|suppliers|grades|sizes|zones|packageTypes)$/.test(u.pathname)){needs('master-data:write');result=app.createReference(u.pathname.split('/')[3],await body(),key);}
      else if(req.method==='POST'&&/^\/api\/master-data\/(products|suppliers|grades|sizes|zones|packageTypes)\/[^/]+\/update$/.test(u.pathname)){needs('master-data:write');const parts=u.pathname.split('/');result=app.updateReference(parts[3],parts[4],await body(),key);}
      else if(req.method==='POST'&&/^\/api\/sessions\/[^/]+\/draft$/.test(u.pathname)){needs('operations:write');result=app.saveSessionDraft(u.pathname.split('/')[3],(await body()).draft);}
      else if(req.method==='POST'&&/^\/api\/sessions\/[^/]+\/(suspend|resume|complete|cancel)$/.test(u.pathname)){needs('operations:write');const parts=u.pathname.split('/');result=app.updateSession(parts[3],parts[4].toUpperCase());}
      else if(req.method==='POST'&&u.pathname==='/api/receiving'){needs('receiving:write');result=app.receive(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/movements'){needs('storage:write');const b=await body();result=app.move(b.batchId,b.zone,b.sessionId,key,b.overrideId);}
      else if(req.method==='POST'&&u.pathname==='/api/containers'){needs('storage:write');result=app.createContainer(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/containers\/[^/]+\/assign$/.test(u.pathname)){needs('storage:write');const b=await body();result=app.assignBatchToContainer(u.pathname.split('/')[3],b.batchId,b.sessionId,key);}
      else if(req.method==='POST'&&/^\/api\/containers\/[^/]+\/move$/.test(u.pathname)){needs('storage:write');const b=await body();result=app.moveContainer(u.pathname.split('/')[3],b.zone,b.sessionId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/transforms'){const b=await body();needs({WASH:'washing:write',SLICE:'slicing:write',MERGE:'operations:write'}[b.process]??'operations:write');result=app.transform(b,key);}
      else if(req.method==='POST'&&u.pathname==='/api/cycles'){const b=await body();needs(b.type==='FREEZE'?'freezing:write':'drying:write');result=app.createCycle(b,key);}
      else if(req.method==='POST'&&/^\/api\/cycles\/[^/]+\/(start|pause|resume|complete|finish|fail|cancel)$/.test(u.pathname)){const parts=u.pathname.split('/'),cycle=app.state.cycles.find(x=>x.id===parts[3]);needs(cycle?.type==='FREEZE'?'freezing:write':'drying:write');result=app.transitionCycle(parts[3],parts[4].toUpperCase(),await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/sorting'){needs('sorting:write');result=app.sortBatch(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/packages'){needs('packaging:write');const b=await body();app.reference('packageTypes',b.type);result=app.createPackage(b,key);}
      else if(req.method==='POST'&&/^\/api\/packages\/[^/]+\/(pack|seal|print|print_success|print_fail|retry|ready|ship)$/.test(u.pathname)){needs('packaging:write');const parts=u.pathname.split('/');result=app.transitionPackage(parts[3],parts[4].toUpperCase(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/shipments'){needs('shipping:write');result=app.createShipment(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/internal-transfers/receive'){needs('operations:write');result=app.receiveInternalTransfer(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/shipments\/[^/]+\/(load|dispatch|deliver|cancel)$/.test(u.pathname)){needs('shipping:write');const parts=u.pathname.split('/');result=app.updateShipment(parts[3],parts[4].toUpperCase(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/tasks'){needs('operations:write');result=app.createTask(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/exceptions'){needs('operations:write');result=app.raiseException(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/exceptions\/[^/]+\/assign$/.test(u.pathname)){needs('operations:write');result=app.assignException(u.pathname.split('/')[3],await body(),key);}
      else if(req.method==='POST'&&/^\/api\/exceptions\/[^/]+\/resolve$/.test(u.pathname)){needs('override:approve');const b=await body();result=app.resolveException(u.pathname.split('/')[3],{...b,resolvedBy:user.sub},key);}
      else if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/claim$/.test(u.pathname)){needs('operations:write');const b=await body();result=app.claimTask(u.pathname.split('/')[3],b.operatorId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/quality-checks'){needs('quality:approve');result=app.qualityCheck(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/quality-checks/release'){needs('quality:approve');result=app.releaseQuarantine(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/inventory-adjustments'){needs('inventory:adjust.approve');result=app.adjustInventory(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/configurations'){needs('config:write');result=app.createConfiguration(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/configurations\/[^/]+\/(approve|activate)$/.test(u.pathname)){needs('config:approve');const parts=u.pathname.split('/'),b=await body();result=app.transitionConfiguration(parts[3],parts[4].toUpperCase(),b.userId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/overrides'){needs('operations:write');result=app.requestOverride(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/overrides\/[^/]+\/resolve$/.test(u.pathname)){needs('override:approve');result=app.resolveOverride(u.pathname.split('/')[3],await body(),key);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/complete$/.test(u.pathname)){needs('print:write');const b=await body();result=app.completePrint(u.pathname.split('/')[3],b.sessionId);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/fail$/.test(u.pathname)){needs('print:write');const b=await body();result=app.failPrint(u.pathname.split('/')[3],b.reason,b.sessionId);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/retry$/.test(u.pathname)){needs('print:write');const b=await body();result=app.retryPrint(u.pathname.split('/')[3],b.verifiedScan,b.sessionId);}
      else return send(404,{success:false,errorCode:'NOT_FOUND',message:'Route not found'});
      await app.flush(); send(201,{success:true,data:result});
    } catch(e){stats.errors++;app.record('REQUEST_FAILED',null,{method:req.method,path:req.url,errorCode:e.code??'SYSTEM'},null,auditContext.deviceId,'FAILURE');app.persist();const failure=errorResponse(e);if(failure.status>=500)console.error(JSON.stringify({level:'error',site:app.site,errorCode:e.code??'SYSTEM',message:e.message,at:new Date().toISOString()}));send(failure.status,failure.body);}
    });
  });
  server.stats=stats;return server;
}

export async function createRuntimeServer() {
  const site = process.env.SITE_CODE || 'IRAN'; let repository; let initialState;
  if (process.env.DATABASE_URL) { repository = new PostgresRepository({ siteCode:site }); initialState = await repository.load(); }
  else repository = process.env.DATA_FILE ? new JsonRepository(process.env.DATA_FILE) : null;
  const app = new StoreMesh({ site, repository: process.env.DATABASE_URL ? null : repository, initialState });
  if (process.env.DATABASE_URL) app.repository = repository;
  const authStore=process.env.DATABASE_URL?new PostgresAuthStore({pool:repository.pool,siteId:repository.siteId,siteCode:site}):null,auth=new AuthService({site,store:authStore});await auth.hydrate();
  const server=createServer({ app, auth, requireAuth:authRequiredFromEnvironment() });await auth.flush();
  const publisher=new OutboxPublisher({app,cloudUrl:process.env.CLOUD_URL,siteKey:process.env.SITE_SYNC_KEY});publisher.start();server.on('close',()=>publisher.stop());server.storemesh={app,publisher};return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT||3000);const server=await createRuntimeServer();server.listen(port,()=>console.log(`StoreMesh site server on ${port}`));}
