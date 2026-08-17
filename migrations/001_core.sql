CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  username text NOT NULL,
  password_hash text NOT NULL,
  roles jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'ACTIVE',
  UNIQUE(site_id, username)
);

CREATE TABLE IF NOT EXISTS operational_sessions (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  operator_id uuid,
  station text NOT NULL,
  status text NOT NULL,
  draft jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  product text NOT NULL,
  grade text NOT NULL,
  size text NOT NULL,
  supplier text,
  harvest_period text,
  weight_kg numeric(14,3) NOT NULL CHECK (weight_kg >= 0),
  zone text NOT NULL,
  status text NOT NULL,
  process text,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id, code)
);

CREATE TABLE IF NOT EXISTS batch_genealogy (
  parent_batch_id uuid NOT NULL REFERENCES batches(id),
  child_batch_id uuid NOT NULL REFERENCES batches(id),
  input_weight_kg numeric(14,3),
  PRIMARY KEY(parent_batch_id, child_batch_id),
  CHECK(parent_batch_id <> child_batch_id)
);

CREATE TABLE IF NOT EXISTS measurements (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  session_id uuid REFERENCES operational_sessions(id),
  weight_kg numeric(14,3) NOT NULL CHECK(weight_kg > 0),
  reason text NOT NULL,
  measured_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  from_zone text NOT NULL,
  to_zone text NOT NULL,
  moved_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  shipment_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id, code)
);

CREATE TABLE IF NOT EXISTS package_items (
  package_id uuid NOT NULL REFERENCES packages(id),
  batch_id uuid NOT NULL REFERENCES batches(id),
  weight_kg numeric(14,3) NOT NULL CHECK(weight_kg > 0),
  PRIMARY KEY(package_id, batch_id)
);

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  destination_site text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id, code)
);
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_shipment_fk;
ALTER TABLE packages ADD CONSTRAINT packages_shipment_fk FOREIGN KEY(shipment_id) REFERENCES shipments(id);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  title text NOT NULL,
  zone text NOT NULL,
  priority integer NOT NULL,
  status text NOT NULL,
  assigned_to uuid,
  entity_id uuid,
  created_at timestamptz NOT NULL,
  claimed_at timestamptz
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  result text NOT NULL CHECK(result IN ('APPROVED','REJECTED','QUARANTINED')),
  notes text NOT NULL DEFAULT '',
  inspector_id uuid,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  label text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  printed_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  event_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY REFERENCES audit_events(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL,
  delivered_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  site_id uuid NOT NULL REFERENCES sites(id),
  idempotency_key text NOT NULL,
  action text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS site_snapshots (
  site_code text PRIMARY KEY,
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batches_zone_status_idx ON batches(site_id, zone, status);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(site_id, status, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_task_claim_idx ON tasks(id) WHERE status = 'IN_PROGRESS';
