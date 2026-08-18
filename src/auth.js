import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

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

export class AuthService {
  constructor({ secret = process.env.AUTH_SECRET, site = 'IRAN', clock = () => Date.now(), lockThreshold = 5, lockDurationMs = 15 * 60 * 1000 } = {}) {
    if (!secret && (process.env.NODE_ENV === 'production' || process.env.AUTH_REQUIRED === 'true')) throw new Error('AUTH_SECRET is required when authentication is enabled');
    secret ??= randomBytes(32).toString('hex');
    this.secret = secret; this.site = site; this.clock = clock; this.lockThreshold=lockThreshold;this.lockDurationMs=lockDurationMs;this.users = new Map();this.sessions=new Map();this.dummySalt=randomBytes(16).toString('hex');this.dummyHash=scryptSync(randomBytes(32),this.dummySalt,64);
  }
  addUser({ id, username, password, roles = ['OPERATOR'], site = this.site }) {
    const salt = randomBytes(16).toString('hex');
    this.users.set(username, { id, username, site, roles, salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), status: 'ACTIVE', failedLoginCount:0, lockedUntil:null });
  }
  login(username, password, deviceId = null) {
    const user = this.users.get(username);
    if(user?.status==='LOCKED'&&user.lockedUntil&&user.lockedUntil<=this.clock()){user.status='ACTIVE';user.failedLoginCount=0;user.lockedUntil=null}
    const supplied = scryptSync(password, user?.salt??this.dummySalt, 64),expected=user?Buffer.from(user.passwordHash,'hex'):this.dummyHash;
    if (!user || user.status !== 'ACTIVE') {timingSafeEqual(supplied,expected);return null}
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)){user.failedLoginCount++;if(user.failedLoginCount>=this.lockThreshold){user.status='LOCKED';user.lockedUntil=this.clock()+this.lockDurationMs}return null}
    user.failedLoginCount=0;user.lockedUntil=null;const jti=randomUUID(),payload = { sub: user.id, username, site: user.site, roles: user.roles, deviceId, jti, iat:Math.floor(this.clock()/1000), exp:Math.floor(this.clock()/1000) + 8 * 60 * 60 };
    this.sessions.set(jti,{id:jti,userId:user.id,deviceId,status:'ACTIVE',createdAt:this.clock(),expiresAt:payload.exp*1000});
    const encoded = b64(payload), unsigned=`${header}.${encoded}`; return `${unsigned}.${createHmac('sha256', this.secret).update(unsigned).digest('base64url')}`;
  }
  verify(token) {
    if (!token || token.split('.').length!==3) return null; const [encodedHeader,encoded,signature] = token.split('.');
    const parsedHeader=parse(encodedHeader);if(parsedHeader.alg!=='HS256'||parsedHeader.typ!=='JWT')return null;const expected = createHmac('sha256', this.secret).update(`${encodedHeader}.${encoded}`).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = parse(encoded);if(payload.exp<=Math.floor(this.clock()/1000))return null;if(payload.site!==this.site)throw new SiteTokenError(payload.site,this.site);if(!payload.jti||this.sessions.get(payload.jti)?.status!=='ACTIVE')return null;return payload;
  }
  revokeSession(id,revokedBy){const session=this.sessions.get(id);if(!session)return false;session.status='REVOKED';session.revokedBy=revokedBy;session.revokedAt=this.clock();return true}
  unlockUser(username){const user=this.users.get(username);if(!user)return false;user.status='ACTIVE';user.failedLoginCount=0;user.lockedUntil=null;return true}
}

export const permissions = {
  ADMIN: ['*'], MANAGER: ['inventory:read','operations:write','storage:write','shipment:write','print:write','quality:approve','inventory:adjust.approve','config:write','config:approve','override:approve','audit:read','session:revoke'],
  RECEIVING_OPERATOR:['inventory:read','operations:write','receiving:write','print:write'],STORAGE_OPERATOR:['inventory:read','operations:write','storage:write'],SORTING_OPERATOR:['inventory:read','operations:write','sorting:write','print:write'],WASHING_OPERATOR:['inventory:read','operations:write','washing:write'],SLICING_OPERATOR:['inventory:read','operations:write','slicing:write'],FREEZING_OPERATOR:['inventory:read','operations:write','freezing:write'],DRYING_OPERATOR:['inventory:read','operations:write','drying:write'],PACKAGING_OPERATOR:['inventory:read','operations:write','packaging:write','print:write'],SHIPPING_OPERATOR:['inventory:read','shipping:write','shipment:write'],QUALITY_OPERATOR:['inventory:read','quality:approve','inventory:adjust.approve','audit:read'], VIEWER: ['inventory:read']
};
export function authorized(user, permission) { return user?.roles?.some(role => permissions[role]?.includes('*') || permissions[role]?.includes(permission)); }
