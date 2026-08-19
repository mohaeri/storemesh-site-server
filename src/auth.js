import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parse = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const header = b64({ alg:'HS256', typ:'JWT' });

export function authRequiredFromEnvironment(env = process.env) {
  const configured=env.AUTH_REQUIRED?.trim().toLowerCase();
  if(configured!==undefined&&!['true','false'].includes(configured))throw new Error('AUTH_REQUIRED must be true or false');
  if(env.NODE_ENV==='production'&&configured!=='true')throw new Error('Production requires AUTH_REQUIRED=true');
  return configured!=='false';
}

export class SiteTokenError extends Error {
  constructor(tokenSite,expectedSite){super(`Token issued for ${tokenSite} cannot access ${expectedSite}`);this.code='BR-SITE-001';this.status=403;this.category='SITE'}
}

const stableUserId=(site,username)=>{const h=createHash('sha256').update(`storemesh:user:${site}:${username}`).digest('hex').slice(0,32);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`};
export class PostgresAuthStore{
  constructor({pool,siteId,siteCode}){this.pool=pool;this.siteId=siteId;this.siteCode=siteCode}
  async ensureSite(){await this.pool.query(`INSERT INTO sites(id,code,name,timezone,status) VALUES($1,$2,$2,'UTC','ACTIVE') ON CONFLICT(code) DO UPDATE SET status='ACTIVE'`,[this.siteId,this.siteCode])}
  async load(){await this.ensureSite();const[users,sessions,skills,userSkills]=await Promise.all([this.pool.query('SELECT * FROM users WHERE site_id=$1',[this.siteId]),this.pool.query('SELECT * FROM auth_sessions WHERE site_id=$1 AND expires_at>now()',[this.siteId]),this.pool.query('SELECT * FROM skills ORDER BY code'),this.pool.query('SELECT us.user_id,us.skill_id FROM user_skills us WHERE us.site_id=$1',[this.siteId])]);return{users:users.rows.map(x=>{const[salt,passwordHash]=x.password_hash.split(':');return{id:x.external_id??x.id,dbId:x.id,username:x.username,site:this.siteCode,roles:x.roles,skills:userSkills.rows.filter(s=>s.user_id===x.id).map(s=>s.skill_id),salt,passwordHash,status:x.status,failedLoginCount:x.failed_login_count,lockedUntil:x.locked_until?.getTime?.()??(x.locked_until?Date.parse(x.locked_until):null)}}),sessions:sessions.rows.map(x=>({id:x.id,userId:x.user_id,deviceId:x.device_id,status:x.status,createdAt:x.created_at?.getTime?.()??Date.parse(x.created_at),expiresAt:x.expires_at?.getTime?.()??Date.parse(x.expires_at),revokedAt:x.revoked_at?.getTime?.()??(x.revoked_at?Date.parse(x.revoked_at):null),revokedBy:x.revoked_by})),skills:skills.rows.map(x=>({id:x.id,code:x.code,name:x.name}))}}
  async saveUser(user){await this.ensureSite();await this.pool.query(`INSERT INTO users(id,site_id,username,password_hash,roles,status,failed_login_count,locked_until,external_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(site_id,username) DO UPDATE SET password_hash=EXCLUDED.password_hash,roles=EXCLUDED.roles,status=EXCLUDED.status,failed_login_count=EXCLUDED.failed_login_count,locked_until=EXCLUDED.locked_until,external_id=EXCLUDED.external_id`,[stableUserId(this.siteCode,user.username),this.siteId,user.username,`${user.salt}:${user.passwordHash}`,JSON.stringify(user.roles),user.status,user.failedLoginCount,user.lockedUntil?new Date(user.lockedUntil):null,user.id])}
  async saveSession(session){await this.ensureSite();await this.pool.query(`INSERT INTO auth_sessions(id,site_id,user_id,device_id,status,created_at,expires_at,revoked_at,revoked_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,revoked_at=EXCLUDED.revoked_at,revoked_by=EXCLUDED.revoked_by`,[session.id,this.siteId,session.userId,session.deviceId??null,session.status,new Date(session.createdAt),new Date(session.expiresAt),session.revokedAt?new Date(session.revokedAt):null,session.revokedBy??null])}
  async createSkill(skill){await this.pool.query('INSERT INTO skills(id,code,name) VALUES($1,$2,$3)',[skill.id,skill.code,skill.name])}
  async assignSkill(userId,skillId){const user=await this.pool.query('SELECT id FROM users WHERE site_id=$1 AND (id::text=$2 OR external_id=$2)',[this.siteId,userId]);if(!user.rows[0])return false;const skill=await this.pool.query('SELECT id FROM skills WHERE id=$1',[skillId]);if(!skill.rows[0])return false;await this.pool.query('INSERT INTO user_skills(site_id,user_id,skill_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.siteId,user.rows[0].id,skillId]);return true}
  async revokeSkill(userId,skillId){const result=await this.pool.query('DELETE FROM user_skills us USING users u WHERE us.site_id=$1 AND us.user_id=u.id AND (u.id::text=$2 OR u.external_id=$2) AND us.skill_id=$3',[this.siteId,userId,skillId]);return result.rowCount>0}
}

export class AuthService {
  constructor({ secret = process.env.AUTH_SECRET, site = 'IRAN', clock = () => Date.now(), lockThreshold = 5, lockDurationMs = 15 * 60 * 1000, store = null } = {}) {
    if (!secret && (process.env.NODE_ENV === 'production' || process.env.AUTH_REQUIRED === 'true')) throw new Error('AUTH_SECRET is required when authentication is enabled');
    secret ??= randomBytes(32).toString('hex');
    this.secret = secret; this.site = site; this.clock = clock; this.lockThreshold=lockThreshold;this.lockDurationMs=lockDurationMs;this.store=store;this.pendingPersistence=Promise.resolve();this.users = new Map();this.sessions=new Map();this.skills=new Map();this.dummySalt=randomBytes(16).toString('hex');this.dummyHash=scryptSync(randomBytes(32),this.dummySalt,64);
  }
  async hydrate(){if(!this.store)return this;const state=await this.store.load();this.users=new Map(state.users.map(x=>[x.username,x]));this.sessions=new Map(state.sessions.map(x=>[x.id,x]));this.skills=new Map((state.skills??[]).map(x=>[x.id,x]));return this}
  queue(work){if(this.store)this.pendingPersistence=this.pendingPersistence.then(work);return this.pendingPersistence}
  flush(){return this.pendingPersistence}
  persistUser(user){this.queue(()=>this.store.saveUser(user))}
  persistSession(session){this.queue(()=>this.store.saveSession(session))}
  addUser({ id, username, password, roles = ['OPERATOR'], site = this.site }) {
    const salt = randomBytes(16).toString('hex');
    const user={ id, username, site, roles,skills:[], salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), status: 'ACTIVE', failedLoginCount:0, lockedUntil:null };this.users.set(username,user);this.persistUser(user);
  }
  login(username, password, deviceId = null) {
    const user = this.users.get(username);
    if(user?.status==='LOCKED'&&user.lockedUntil&&user.lockedUntil<=this.clock()){user.status='ACTIVE';user.failedLoginCount=0;user.lockedUntil=null;this.persistUser(user)}
    const supplied = scryptSync(password, user?.salt??this.dummySalt, 64),expected=user?Buffer.from(user.passwordHash,'hex'):this.dummyHash;
    if (!user || user.status !== 'ACTIVE') {timingSafeEqual(supplied,expected);return null}
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)){user.failedLoginCount++;if(user.failedLoginCount>=this.lockThreshold){user.status='LOCKED';user.lockedUntil=this.clock()+this.lockDurationMs}this.persistUser(user);return null}
    user.failedLoginCount=0;user.lockedUntil=null;const jti=randomUUID(),payload = { sub: user.id, username, site: user.site, roles: user.roles,skills:[...(user.skills??[])], deviceId, jti, iat:Math.floor(this.clock()/1000), exp:Math.floor(this.clock()/1000) + 8 * 60 * 60 };
    this.persistUser(user);const session={id:jti,userId:user.id,deviceId,status:'ACTIVE',createdAt:this.clock(),expiresAt:payload.exp*1000};this.sessions.set(jti,session);this.persistSession(session);
    const encoded = b64(payload), unsigned=`${header}.${encoded}`; return `${unsigned}.${createHmac('sha256', this.secret).update(unsigned).digest('base64url')}`;
  }
  verify(token) {
    if (!token || token.split('.').length!==3) return null; const [encodedHeader,encoded,signature] = token.split('.');
    const parsedHeader=parse(encodedHeader);if(parsedHeader.alg!=='HS256'||parsedHeader.typ!=='JWT')return null;const expected = createHmac('sha256', this.secret).update(`${encodedHeader}.${encoded}`).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = parse(encoded);if(payload.exp<=Math.floor(this.clock()/1000))return null;if(payload.site!==this.site)throw new SiteTokenError(payload.site,this.site);if(!payload.jti||this.sessions.get(payload.jti)?.status!=='ACTIVE')return null;return payload;
  }
  revokeSession(id,revokedBy){const session=this.sessions.get(id);if(!session)return false;session.status='REVOKED';session.revokedBy=revokedBy;session.revokedAt=this.clock();this.persistSession(session);return true}
  unlockUser(username){const user=this.users.get(username);if(!user)return false;user.status='ACTIVE';user.failedLoginCount=0;user.lockedUntil=null;this.persistUser(user);return true}
  userById(id){return[...this.users.values()].find(x=>x.id===id||x.dbId===id)}
  async createSkill({code,name}){code=String(code??'').trim();name=String(name??'').trim();if(!code||!name)throw Object.assign(new Error('Skill code and name are required'),{code:'SKILL_FIELDS_REQUIRED',status:400});if([...this.skills.values()].some(x=>x.code===code))throw Object.assign(new Error('Skill code already exists'),{code:'SKILL_CODE_DUPLICATE',status:409});const skill={id:randomUUID(),code,name};if(this.store)await this.store.createSkill(skill);this.skills.set(skill.id,skill);return skill}
  async assignSkill(userId,skillId){const user=this.userById(userId);if(!user||!this.skills.has(skillId)||this.store&&!(await this.store.assignSkill(userId,skillId)))return false;user.skills??=[];if(!user.skills.includes(skillId))user.skills.push(skillId);return true}
  async revokeSkill(userId,skillId){const user=this.userById(userId);if(!user)return false;const existed=user.skills?.includes(skillId);if(this.store&&!(await this.store.revokeSkill(userId,skillId)))return false;user.skills=(user.skills??[]).filter(x=>x!==skillId);return !!existed}
}

export const permissions = {
  ADMIN: ['*'], MANAGER: ['inventory:read','operations:write','storage:write','shipment:write','print:write','quality:approve','inventory:adjust.approve','config:write','config:approve','override:approve','audit:read','session:revoke','session:terminate','master-data:write','user-skills:write'],
  RECEIVING_OPERATOR:['inventory:read','operations:write','receiving:write','print:write'],STORAGE_OPERATOR:['inventory:read','operations:write','storage:write'],SORTING_OPERATOR:['inventory:read','operations:write','sorting:write','print:write'],WASHING_OPERATOR:['inventory:read','operations:write','washing:write'],SLICING_OPERATOR:['inventory:read','operations:write','slicing:write'],FREEZING_OPERATOR:['inventory:read','operations:write','freezing:write'],DRYING_OPERATOR:['inventory:read','operations:write','drying:write'],PACKAGING_OPERATOR:['inventory:read','operations:write','packaging:write','print:write'],SHIPPING_OPERATOR:['inventory:read','shipping:write','shipment:write'],QUALITY_OPERATOR:['inventory:read','quality:approve','inventory:adjust.approve','audit:read'], VIEWER: ['inventory:read']
};
export function authorized(user, permission) { return user?.roles?.some(role => permissions[role]?.includes('*') || permissions[role]?.includes(permission)); }
