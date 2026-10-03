import { spawn } from 'node:child_process';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export function parsePositiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function makeConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const iterations = parsePositiveInteger(env.SOAK_ITERATIONS, 1, 'SOAK_ITERATIONS');
  const durationMinutes = parsePositiveInteger(env.SOAK_DURATION_MINUTES, 60, 'SOAK_DURATION_MINUTES');
  return {
    databaseUrl: env.DATABASE_URL,
    iterations,
    durationMs: durationMinutes * 60_000,
    intervalMs: parsePositiveInteger(env.SOAK_INTERVAL_SECONDS, 60, 'SOAK_INTERVAL_SECONDS') * 1_000,
    command: process.execPath,
    args: ['--test', '--test-name-pattern', 'real PostgreSQL domain chain', 'test/part-a-postgres.test.js'],
    healthUrl: env.SOAK_HEALTH_URL || null,
    logPath: env.SOAK_LOG_PATH || 'artifacts/soak-results.jsonl',
    maxAuditGrowth: parsePositiveInteger(env.SOAK_MAX_AUDIT_GROWTH, 1000, 'SOAK_MAX_AUDIT_GROWTH'),
    maxOutboxGrowth: parsePositiveInteger(env.SOAK_MAX_OUTBOX_GROWTH, 1000, 'SOAK_MAX_OUTBOX_GROWTH'),
    maxDeadLetters: Number(env.SOAK_MAX_DEAD_LETTERS ?? 0)
  };
}

export async function execute(command, args, { env = process.env } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

export async function probeDatabase(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query(`SELECT
      (SELECT count(*)::int FROM audit_events) AS audit_count,
      (SELECT count(*)::int FROM outbox_events) AS outbox_count,
      (SELECT count(*)::int FROM outbox_events WHERE status='PENDING') AS outbox_pending,
      (SELECT count(*)::int FROM outbox_events WHERE status='DEAD_LETTER') AS outbox_dead_letters`);
    const row = result.rows[0];
    return { auditCount: row.audit_count, outboxCount: row.outbox_count, outboxPending: row.outbox_pending, outboxDeadLetters: row.outbox_dead_letters };
  } finally { await pool.end(); }
}

export async function probeHealth(url, fetchImpl = fetch) {
  if (!url) return { checked: false };
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    return { checked: true, ok: response.ok, status: response.status };
  } catch (error) { return { checked: true, ok: false, error: error.message }; }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runSoak(config, dependencies = {}) {
  const runCommand = dependencies.execute ?? execute;
  const dbProbe = dependencies.probeDatabase ?? probeDatabase;
  const healthProbe = dependencies.probeHealth ?? probeHealth;
  const sleep = dependencies.sleep ?? wait;
  const now = dependencies.now ?? (() => Date.now());
  const write = dependencies.write ?? (async record => {
    await mkdir(dirname(config.logPath), { recursive: true });
    await appendFile(config.logPath, `${JSON.stringify(record)}\n`, 'utf8');
  });
  const started = now();
  const baseline = await dbProbe(config.databaseUrl);
  let previous = baseline;
  const records = [];
  for (let iteration = 1; iteration <= config.iterations && now() - started < config.durationMs; iteration++) {
    const iterationStarted = now();
    const healthBefore = await healthProbe(config.healthUrl);
    const command = await runCommand(config.command, config.args, { env: { ...process.env, DATABASE_URL: config.databaseUrl } });
    const metrics = await dbProbe(config.databaseUrl);
    const healthAfter = await healthProbe(config.healthUrl);
    const delta = { audit: metrics.auditCount - previous.auditCount, outbox: metrics.outboxCount - previous.outboxCount };
    const violations = [];
    if (command.code !== 0) violations.push(`business-chain exited ${command.code}`);
    if (healthBefore.checked && !healthBefore.ok) violations.push('health check failed before iteration');
    if (healthAfter.checked && !healthAfter.ok) violations.push('health check failed after iteration');
    if (delta.audit > config.maxAuditGrowth) violations.push(`audit growth ${delta.audit} exceeds ${config.maxAuditGrowth}`);
    if (delta.outbox > config.maxOutboxGrowth) violations.push(`outbox growth ${delta.outbox} exceeds ${config.maxOutboxGrowth}`);
    if (metrics.outboxDeadLetters > config.maxDeadLetters) violations.push(`dead letters ${metrics.outboxDeadLetters} exceeds ${config.maxDeadLetters}`);
    const record = { timestamp: new Date(iterationStarted).toISOString(), iteration, durationMs: now() - iterationStarted, passed: violations.length === 0, violations, healthBefore, healthAfter, metrics, delta, command: { code: command.code, stdout: command.stdout.slice(-4000), stderr: command.stderr.slice(-4000) } };
    await write(record); records.push(record); previous = metrics;
    if (violations.length) break;
    if (iteration < config.iterations && now() - started + config.intervalMs < config.durationMs) await sleep(config.intervalMs);
  }
  return { passed: records.length > 0 && records.every(x => x.passed), baseline, records };
}
