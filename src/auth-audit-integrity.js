const credentialFingerprint=value=>value?String(value).slice(0,16):null;

export async function applyAuditedAuthMutation({pool,apply,record,writeAudit,restore}){
  const client=pool?.connect?await pool.connect():null;
  try{
    if(client)await client.query('BEGIN');
    const mutation=await apply(client),event=record(mutation);
    await writeAudit(event,client);
    if(client)await client.query('COMMIT');
    return mutation;
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    await restore?.();
    throw error;
  }finally{client?.release?.()}
}

export function reconcileAuthAudit({auth,app,logger=console.warn}={}){
  const findings=[],events=(app?.state?.audit??[]).filter(event=>['USER_ROLE_ASSIGNED','USER_ROLE_REVOKED','USER_BADGE_REGENERATED','USER_BADGE_PIN_RESET'].includes(event.type));
  const latest=(type,userId,predicate=()=>true)=>events.filter(event=>event.type===type&&String(event.entityId)===String(userId)&&predicate(event)).sort((a,b)=>Number(a.sequence??0)-Number(b.sequence??0)||Date.parse(a.occurredAt??0)-Date.parse(b.occurredAt??0)).at(-1);
  for(const user of auth.users.values()){
    for(const roleCode of user.roles??[]){const grant=latest('USER_ROLE_ASSIGNED',user.id,event=>event.payload?.roleCode===roleCode),revoke=latest('USER_ROLE_REVOKED',user.id,event=>event.payload?.roleCode===roleCode);if(!grant||revoke&&Number(revoke.sequence??0)>Number(grant.sequence??0))findings.push({code:'AUTH_ROLE_WITHOUT_AUDIT_GRANT',userId:user.id,roleCode})}
    for(const event of events.filter(item=>String(item.entityId)===String(user.id)&&['USER_ROLE_ASSIGNED','USER_ROLE_REVOKED'].includes(item.type))){const roleCode=event.payload?.roleCode;if(!roleCode)continue;const grant=latest('USER_ROLE_ASSIGNED',user.id,item=>item.payload?.roleCode===roleCode),revoke=latest('USER_ROLE_REVOKED',user.id,item=>item.payload?.roleCode===roleCode),expected=grant&&(!revoke||Number(grant.sequence??0)>Number(revoke.sequence??0)),actual=(user.roles??[]).includes(roleCode);if(Boolean(expected)!==actual&&!findings.some(item=>item.code==='AUDIT_ROLE_STATE_MISMATCH'&&item.userId===user.id&&item.roleCode===roleCode))findings.push({code:'AUDIT_ROLE_STATE_MISMATCH',userId:user.id,roleCode,expected:Boolean(expected),actual})}
    for(const [field,type,code]of[['badgeCodeHash','USER_BADGE_REGENERATED','AUTH_BADGE_AUDIT_MISMATCH'],['badgePinHash','USER_BADGE_PIN_RESET','AUTH_PIN_AUDIT_MISMATCH']]){const event=latest(type,user.id),actual=Boolean(user[field]);if(actual&&!event||event&&!actual||actual&&event?.payload?.credentialFingerprint&&event.payload.credentialFingerprint!==credentialFingerprint(user[field]))findings.push({code,userId:user.id,expected:Boolean(event),actual})}
  }
  const report={checkedAt:new Date().toISOString(),site:app?.site??auth.site,findings};if(findings.length)logger(JSON.stringify({level:'warn',component:'auth-audit-reconciliation',...report}));return report;
}

export { credentialFingerprint };
