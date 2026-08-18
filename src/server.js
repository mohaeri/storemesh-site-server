import http from 'node:http';
import { StoreMesh, DomainError } from './domain.js';
import { AuthService, authorized } from './auth.js';
import { JsonRepository } from './persistence.js';
import { PostgresRepository } from './postgres-repository.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { errorResponse } from './errors.js';

export function createServer({ app = new StoreMesh({ site: process.env.SITE_CODE || 'IRAN', repository: process.env.DATA_FILE ? new JsonRepository(process.env.DATA_FILE) : null }), auth = null, requireAuth = false } = {}) {
  auth ??= new AuthService({ site: app.site });
  if (!auth.users.size) {
    const demoAllowed=process.env.NODE_ENV!=='production'&&process.env.ALLOW_DEMO_CREDENTIALS!=='false';
    if(!demoAllowed&&(!process.env.BOOTSTRAP_ADMIN_USER||!process.env.BOOTSTRAP_ADMIN_PASSWORD))throw new Error('Production bootstrap credentials are required');
    auth.addUser({ id:'admin-1', username:process.env.BOOTSTRAP_ADMIN_USER||'admin', password:process.env.BOOTSTRAP_ADMIN_PASSWORD||'storemesh-demo', roles:['ADMIN'] });
    if(demoAllowed)auth.addUser({ id:'operator-1', username:'operator', password:'operator-demo', roles:['OPERATOR'] });
  }
  const stats={requests:0,errors:0,startedAt:Date.now()};
  const server=http.createServer(async (req,res)=>{
    stats.requests++;
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Idempotency-Key,Authorization'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const body=async()=>{let raw='';for await(const c of req)raw+=c;return raw?JSON.parse(raw):{};};
    try {
      const u=new URL(req.url,'http://localhost'); const key=req.headers['idempotency-key']; let result;
      if(req.method==='GET'&&u.pathname==='/health') return send(200,{status:'ok',site:app.site});
      if(req.method==='GET'&&u.pathname==='/ready'){try{if(app.repository?.ready)await app.repository.ready();return send(200,{status:'ready',site:app.site})}catch{return send(503,{status:'not_ready',site:app.site})}}
      if(req.method==='GET'&&u.pathname==='/metrics'){res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4'});return res.end([`storemesh_http_requests_total ${stats.requests}`,`storemesh_http_errors_total ${stats.errors}`,`storemesh_uptime_seconds ${Math.floor((Date.now()-stats.startedAt)/1000)}`,`storemesh_batches ${app.state.batches.length}`,`storemesh_outbox_pending ${app.state.outbox.filter(x=>x.status==='PENDING').length}`,`storemesh_print_jobs_pending ${app.state.printJobs.filter(x=>x.status==='PENDING').length}`].join('\n')+'\n')}
      if(req.method==='POST'&&u.pathname==='/api/auth/login'){const b=await body();const token=auth.login(b.username,b.password);return token?send(200,{success:true,data:{token}}):send(401,{success:false,errorCode:'INVALID_CREDENTIALS',message:'Invalid credentials'});}
      const user=auth.verify(req.headers.authorization?.replace(/^Bearer /,''));
      if(requireAuth&&!user)return send(401,{success:false,errorCode:'AUTHENTICATION_REQUIRED',message:'Authentication required'});
      const needs=permission=>{if(requireAuth&&!authorized(user,permission))throw new DomainError('FORBIDDEN','Insufficient permission',403);};
      if(req.method==='GET'&&u.pathname==='/api/tasks'){needs('inventory:read');return send(200,{items:app.state.tasks});}
      if(req.method==='GET'&&u.pathname==='/api/containers'){needs('inventory:read');return send(200,{items:app.state.containers});}
      if(req.method==='GET'&&u.pathname==='/api/configurations'){needs('inventory:read');return send(200,{items:app.state.configurationVersions});}
      if(req.method==='GET'&&u.pathname==='/api/overrides'){needs('inventory:read');return send(200,{items:app.state.overrides});}
      if(req.method==='GET'&&u.pathname==='/api/inventory'){needs('inventory:read');return send(200,{items:app.inventory()});}
      if(req.method==='GET'&&u.pathname==='/api/print-jobs'){needs('inventory:read');return send(200,{items:app.state.printJobs});}
      if(req.method==='GET'&&u.pathname==='/api/outbox'){needs('audit:read');return send(200,{items:app.state.outbox});}
      if(req.method==='GET'&&u.pathname==='/api/sessions'){needs('inventory:read');return send(200,{items:app.state.sessions});}
      if(req.method==='GET'&&u.pathname==='/api/packages'){needs('inventory:read');return send(200,{items:app.state.packages});}
      if(req.method==='GET'&&u.pathname==='/api/shipments'){needs('inventory:read');return send(200,{items:app.state.shipments});}
      if(req.method==='GET'&&u.pathname==='/api/quality-checks'){needs('inventory:read');return send(200,{items:app.state.qualityChecks});}
      if(req.method==='GET'&&u.pathname==='/api/inventory-adjustments'){needs('inventory:read');return send(200,{items:app.state.inventoryAdjustments});}
      if(req.method==='GET'&&u.pathname==='/api/audit'){needs('audit:read');return send(200,{items:app.state.audit});}
      if(req.method==='GET'&&u.pathname==='/api/internal-transfers'){needs('inventory:read');return send(200,{items:app.state.internalTransfers});}
      if(req.method==='GET'&&/^\/api\/shipments\/[^/]+\/manifest$/.test(u.pathname))return send(200,app.shipmentManifest(u.pathname.split('/')[3]));
      if(req.method==='GET'&&u.pathname.startsWith('/api/trace/')) return send(200,app.trace(u.pathname.split('/').at(-1)));
      if(req.method==='POST'&&u.pathname==='/api/sessions'){needs('operations:write');result=app.openSession((await body()).operatorId);}
      else if(req.method==='POST'&&/^\/api\/sessions\/[^/]+\/draft$/.test(u.pathname)){needs('operations:write');result=app.saveSessionDraft(u.pathname.split('/')[3],(await body()).draft);}
      else if(req.method==='POST'&&/^\/api\/sessions\/[^/]+\/(suspend|resume|complete|cancel)$/.test(u.pathname)){needs('operations:write');const parts=u.pathname.split('/');result=app.updateSession(parts[3],parts[4].toUpperCase());}
      else if(req.method==='POST'&&u.pathname==='/api/receiving'){needs('operations:write');result=app.receive(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/movements'){needs('operations:write');const b=await body();result=app.move(b.batchId,b.zone,b.sessionId,key,b.overrideId);}
      else if(req.method==='POST'&&u.pathname==='/api/containers'){needs('operations:write');result=app.createContainer(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/containers\/[^/]+\/assign$/.test(u.pathname)){needs('operations:write');const b=await body();result=app.assignBatchToContainer(u.pathname.split('/')[3],b.batchId,b.sessionId,key);}
      else if(req.method==='POST'&&/^\/api\/containers\/[^/]+\/move$/.test(u.pathname)){needs('operations:write');const b=await body();result=app.moveContainer(u.pathname.split('/')[3],b.zone,b.sessionId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/transforms'){needs('operations:write');result=app.transform(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/sorting'){needs('operations:write');result=app.sortBatch(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/packages'){needs('operations:write');result=app.createPackage(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/packages\/[^/]+\/(pack|seal|print|print_success|print_fail|retry|ready|ship)$/.test(u.pathname)){needs('operations:write');const parts=u.pathname.split('/');result=app.transitionPackage(parts[3],parts[4].toUpperCase(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/shipments'){needs('shipment:write');result=app.createShipment(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/internal-transfers/receive'){needs('operations:write');result=app.receiveInternalTransfer(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/shipments\/[^/]+\/(load|dispatch|deliver|cancel)$/.test(u.pathname)){needs('operations:write');const parts=u.pathname.split('/');result=app.updateShipment(parts[3],parts[4].toUpperCase(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/tasks'){needs('operations:write');result=app.createTask(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/tasks\/[^/]+\/claim$/.test(u.pathname)){needs('operations:write');const b=await body();result=app.claimTask(u.pathname.split('/')[3],b.operatorId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/quality-checks'){needs('quality:approve');result=app.qualityCheck(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/quality-checks/release'){needs('quality:approve');result=app.releaseQuarantine(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/inventory-adjustments'){needs('inventory:adjust.approve');result=app.adjustInventory(await body(),key);}
      else if(req.method==='POST'&&u.pathname==='/api/configurations'){needs('config:write');result=app.createConfiguration(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/configurations\/[^/]+\/(approve|activate)$/.test(u.pathname)){needs('config:approve');const parts=u.pathname.split('/'),b=await body();result=app.transitionConfiguration(parts[3],parts[4].toUpperCase(),b.userId,key);}
      else if(req.method==='POST'&&u.pathname==='/api/overrides'){needs('operations:write');result=app.requestOverride(await body(),key);}
      else if(req.method==='POST'&&/^\/api\/overrides\/[^/]+\/resolve$/.test(u.pathname)){needs('override:approve');result=app.resolveOverride(u.pathname.split('/')[3],await body(),key);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/complete$/.test(u.pathname)){needs('print:write');result=app.completePrint(u.pathname.split('/')[3]);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/fail$/.test(u.pathname)){needs('print:write');const b=await body();result=app.failPrint(u.pathname.split('/')[3],b.reason);}
      else if(req.method==='POST'&&/^\/api\/print-jobs\/[^/]+\/retry$/.test(u.pathname)){needs('print:write');const b=await body();result=app.retryPrint(u.pathname.split('/')[3],b.verifiedScan);}
      else return send(404,{success:false,errorCode:'NOT_FOUND',message:'Route not found'});
      await app.flush(); send(201,{success:true,data:result});
    } catch(e){stats.errors++;const failure=errorResponse(e instanceof DomainError?e:Object.assign(e,{status:500}));if(failure.status>=500)console.error(JSON.stringify({level:'error',site:app.site,errorCode:e.code??'SYSTEM',message:e.message,at:new Date().toISOString()}));send(failure.status,failure.body);}
  });
  server.stats=stats;return server;
}

export async function createRuntimeServer() {
  const site = process.env.SITE_CODE || 'IRAN'; let repository; let initialState;
  if (process.env.DATABASE_URL) { repository = new PostgresRepository({ siteCode:site }); initialState = await repository.load(); }
  else repository = process.env.DATA_FILE ? new JsonRepository(process.env.DATA_FILE) : null;
  const app = new StoreMesh({ site, repository: process.env.DATABASE_URL ? null : repository, initialState });
  if (process.env.DATABASE_URL) app.repository = repository;
  const server=createServer({ app, requireAuth:process.env.AUTH_REQUIRED==='true' });
  const publisher=new OutboxPublisher({app,cloudUrl:process.env.CLOUD_URL,siteKey:process.env.SITE_SYNC_KEY});publisher.start();server.on('close',()=>publisher.stop());server.storemesh={app,publisher};return server;
}

if(import.meta.url===`file:///${process.argv[1]?.replaceAll('\\','/')}`){const port=Number(process.env.PORT||3000);const server=await createRuntimeServer();server.listen(port,()=>console.log(`StoreMesh site server on ${port}`));}
