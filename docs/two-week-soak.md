# Two-week PostgreSQL soak

The soak runner repeatedly executes the real domain-order PostgreSQL chain in `test/part-a-postgres.test.js`: receiving, sorting, washing, slicing, freezing, freeze-drying, UNIT/CARTON packaging, customer shipping, persistence, and reload. It writes one JSON object per iteration so interrupted runs retain their history.

It is deliberately bounded by both iteration count and wall-clock duration. It stops on the first failed chain, unhealthy service, excessive audit/outbox growth, or dead-letter threshold breach. It never starts or mutates a production service; use a dedicated soak database.

```powershell
$env:DATABASE_URL = 'postgresql://storemesh:password@localhost:5432/storemesh_soak'
$env:SOAK_ITERATIONS = '2016'
$env:SOAK_DURATION_MINUTES = '20160'
$env:SOAK_INTERVAL_SECONDS = '600'
$env:SOAK_HEALTH_URL = 'http://127.0.0.1:8081/health'
$env:SOAK_LOG_PATH = 'artifacts/two-week-soak.jsonl'
pnpm migrate
pnpm soak
```

`2016` ten-minute intervals span two weeks; the duration cap prevents an accidentally unbounded process. For a CI smoke invocation, use `SOAK_ITERATIONS=2`, `SOAK_DURATION_MINUTES=5`, and `SOAK_INTERVAL_SECONDS=1`. A scheduler can invoke the same command; the runner itself has no external scheduling dependency.

`.github/workflows/soak-smoke.yml` runs that bounded two-iteration check nightly and on manual dispatch, against PostgreSQL 17, and uploads the JSONL log even on failure. It is a fast recurring signal, not a substitute for the continuous two-week run above.

Optional safety thresholds are `SOAK_MAX_AUDIT_GROWTH` and `SOAK_MAX_OUTBOX_GROWTH` (default 1000 per iteration), and `SOAK_MAX_DEAD_LETTERS` (default 0). Health checks are enabled only when `SOAK_HEALTH_URL` is set. Results include UTC timestamp, duration, exit code/output tail, health before/after, counts and count deltas.
