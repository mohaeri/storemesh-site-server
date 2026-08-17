import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parse = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

export class AuthService {
  constructor({ secret = process.env.AUTH_SECRET || 'development-only-change-me', site = 'IRAN', clock = () => Date.now() } = {}) {
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
    const payload = { sub: user.id, username, site: user.site, roles: user.roles, exp: this.clock() + 8 * 60 * 60 * 1000 };
    const encoded = b64(payload); return `${encoded}.${createHmac('sha256', this.secret).update(encoded).digest('base64url')}`;
  }
  verify(token) {
    if (!token?.includes('.')) return null; const [encoded, signature] = token.split('.');
    const expected = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = parse(encoded); return payload.exp > this.clock() ? payload : null;
  }
}

export const permissions = {
  ADMIN: ['*'], MANAGER: ['inventory:read','operations:write','quality:approve','config:write'],
  OPERATOR: ['inventory:read','operations:write'], QUALITY: ['inventory:read','quality:approve'], VIEWER: ['inventory:read']
};
export function authorized(user, permission) { return user?.roles?.some(role => permissions[role]?.includes('*') || permissions[role]?.includes(permission)); }
