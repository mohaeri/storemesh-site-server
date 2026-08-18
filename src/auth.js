import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parse = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const header = b64({ alg:'HS256', typ:'JWT' });

export class AuthService {
  constructor({ secret = process.env.AUTH_SECRET, site = 'IRAN', clock = () => Date.now() } = {}) {
    if (!secret && (process.env.NODE_ENV === 'production' || process.env.AUTH_REQUIRED === 'true')) throw new Error('AUTH_SECRET is required when authentication is enabled');
    secret ??= randomBytes(32).toString('hex');
    this.secret = secret; this.site = site; this.clock = clock; this.users = new Map();
  }
  addUser({ id, username, password, roles = ['OPERATOR'], site = this.site }) {
    const salt = randomBytes(16).toString('hex');
    this.users.set(username, { id, username, site, roles, salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), status: 'ACTIVE' });
  }
  login(username, password) {
    const user = this.users.get(username);
    if (!user || user.status !== 'ACTIVE') return null;
    const supplied = scryptSync(password, user.salt, 64); const expected = Buffer.from(user.passwordHash, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = { sub: user.id, username, site: user.site, roles: user.roles, iat:Math.floor(this.clock()/1000), exp:Math.floor(this.clock()/1000) + 8 * 60 * 60 };
    const encoded = b64(payload), unsigned=`${header}.${encoded}`; return `${unsigned}.${createHmac('sha256', this.secret).update(unsigned).digest('base64url')}`;
  }
  verify(token) {
    if (!token || token.split('.').length!==3) return null; const [encodedHeader,encoded,signature] = token.split('.');
    const parsedHeader=parse(encodedHeader);if(parsedHeader.alg!=='HS256'||parsedHeader.typ!=='JWT')return null;const expected = createHmac('sha256', this.secret).update(`${encodedHeader}.${encoded}`).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = parse(encoded); return payload.exp > Math.floor(this.clock()/1000) ? payload : null;
  }
}

export const permissions = {
  ADMIN: ['*'], MANAGER: ['inventory:read','operations:write','shipment:write','print:write','quality:approve','config:write','audit:read'],
  OPERATOR: ['inventory:read','operations:write','print:write'], QUALITY: ['inventory:read','quality:approve','audit:read'], VIEWER: ['inventory:read']
};
export function authorized(user, permission) { return user?.roles?.some(role => permissions[role]?.includes('*') || permissions[role]?.includes(permission)); }
