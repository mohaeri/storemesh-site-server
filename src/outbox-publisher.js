export class OutboxPublisher {
  constructor({ app, cloudUrl, siteKey, fetchImpl = fetch, intervalMs = 5000,maxAttempts=5,logger=console } = {}) { this.app=app;this.cloudUrl=cloudUrl?.replace(/\/$/,'');this.siteKey=siteKey;this.fetch=fetchImpl;this.intervalMs=intervalMs;this.maxAttempts=maxAttempts;this.logger=logger;this.timer=null;this.metrics={publishFailures:0,deadLetters:0}; }
  async flushOnce(limit=100) {
    const items=this.app.state.outbox.filter(x=>x.status==='PENDING').sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).slice(0,limit);
    if(!items.length)return{accepted:0,duplicates:0};
    const response=await this.fetch(`${this.cloudUrl}/api/events`,{method:'POST',headers:{'Content-Type':'application/json','X-Site-Code':this.app.site,'X-Site-Key':this.siteKey},body:JSON.stringify({items})});
    if(!response.ok){for(const item of items){item.attempts=(item.attempts??0)+1;if(item.attempts>=this.maxAttempts){item.status='DEAD_LETTER';item.deadLetterReason=`HTTP_${response.status}`;this.metrics.deadLetters++}}this.metrics.publishFailures++;this.app.persist();await this.app.flush();throw new Error(`Cloud synchronization failed: ${response.status}`)}const result=await response.json(),now=new Date().toISOString(),delivered=new Set([...(result.acceptedIds??[]),...(result.duplicateIds??[])]),rejected=new Map((result.rejected??[]).map(x=>[x.id,x.errorCode]));for(const item of items){item.attempts=(item.attempts??0)+1;if(delivered.has(item.id)){item.status='DELIVERED';item.deliveredAt=now}else if(rejected.has(item.id)){item.status='DEAD_LETTER';item.deadLetterReason=rejected.get(item.id);this.metrics.deadLetters++}}this.app.persist();await this.app.flush();return result;
  }
  start(){if(!this.cloudUrl||!this.siteKey||this.timer)return;this.timer=setInterval(()=>this.flushOnce().catch(error=>this.logger.error?.(JSON.stringify({level:'error',component:'outbox-publisher',message:error.message,publishFailures:this.metrics.publishFailures}))),this.intervalMs);this.timer.unref?.()}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
