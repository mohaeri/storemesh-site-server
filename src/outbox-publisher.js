export class OutboxPublisher {
  constructor({ app, cloudUrl, siteKey, fetchImpl = fetch, intervalMs = 5000 } = {}) { this.app=app;this.cloudUrl=cloudUrl?.replace(/\/$/,'');this.siteKey=siteKey;this.fetch=fetchImpl;this.intervalMs=intervalMs;this.timer=null; }
  async flushOnce(limit=100) {
    const items=this.app.state.outbox.filter(x=>x.status==='PENDING').sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).slice(0,limit);
    if(!items.length)return{accepted:0,duplicates:0};
    const response=await this.fetch(`${this.cloudUrl}/api/events`,{method:'POST',headers:{'Content-Type':'application/json','X-Site-Code':this.app.site,'X-Site-Key':this.siteKey},body:JSON.stringify({items})});
    if(!response.ok)throw new Error(`Cloud synchronization failed: ${response.status}`);const result=await response.json();const now=new Date().toISOString();
    for(const item of items){item.status='DELIVERED';item.deliveredAt=now;item.attempts=(item.attempts??0)+1}this.app.persist();await this.app.flush();return result;
  }
  start(){if(!this.cloudUrl||!this.siteKey||this.timer)return;this.timer=setInterval(()=>this.flushOnce().catch(()=>{}),this.intervalMs);this.timer.unref?.()}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
