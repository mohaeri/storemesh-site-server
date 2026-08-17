import pg from 'pg';
const { Pool } = pg;

export class PostgresRepository {
  constructor({ connectionString = process.env.DATABASE_URL, siteCode = process.env.SITE_CODE || 'IRAN' } = {}) {
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE || 10) }); this.siteCode = siteCode;
  }
  async load() {
    const { rows } = await this.pool.query('SELECT state FROM site_snapshots WHERE site_code = $1', [this.siteCode]);
    if (!rows[0]) return null; const state = rows[0].state; state.idempotency = new Map(state.idempotency || []); return state;
  }
  async save(state) {
    const serializable = { ...state, idempotency: [...state.idempotency.entries()] };
    await this.pool.query(`INSERT INTO site_snapshots(site_code,state,version) VALUES($1,$2,1)
      ON CONFLICT(site_code) DO UPDATE SET state=EXCLUDED.state,version=site_snapshots.version+1,updated_at=now()`, [this.siteCode, serializable]);
  }
  async ready() { await this.pool.query('SELECT 1'); return true; }
  async close() { await this.pool.end(); }
}
