CREATE TABLE IF NOT EXISTS site_state_versions (
  site_id uuid PRIMARY KEY REFERENCES sites(id),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE containers ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'PRE_SORT'
  CHECK(stage IN ('PRE_SORT','POST_SORT','EXPORT'));

ALTER TABLE batch_genealogy ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'PROCESS'
  CHECK(relationship_type IN ('PROCESS','SORT','GRADE_SPLIT','MERGE','TRANSFER'));

ALTER TABLE batches ADD COLUMN IF NOT EXISTS config_version_id uuid REFERENCES configuration_versions(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS config_version_id uuid REFERENCES configuration_versions(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS override_id uuid REFERENCES manager_overrides(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS fifo_rank integer;

ALTER TABLE packages ADD COLUMN IF NOT EXISTS parent_package_id uuid REFERENCES packages(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'CARTON'
  CHECK(level IN ('UNIT','CARTON','EPS','PALLET'));
UPDATE packages SET status='READY_TO_SHIP' WHERE status='READY';
UPDATE packages SET status='LABEL_PRINTED' WHERE status='PRINTED';
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages ADD CONSTRAINT packages_status_check CHECK(status IN (
  'DRAFT','PACKING','READY_FOR_LABEL','PRINTING','LABEL_PENDING','LABEL_PRINTED',
  'READY_TO_SHIP','SHIPPED','CANCELLED'
));

CREATE TABLE IF NOT EXISTS labels (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  identity text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK(status IN ('PENDING','VERIFIED','VOID')),
  created_at timestamptz NOT NULL,
  UNIQUE(site_id,entity_type,entity_id),
  UNIQUE(site_id,identity)
);

CREATE TABLE IF NOT EXISTS print_attempts (
  id uuid PRIMARY KEY,
  label_id uuid NOT NULL REFERENCES labels(id),
  attempt_no integer NOT NULL CHECK(attempt_no > 0),
  status text NOT NULL CHECK(status IN ('PENDING','PRINTED','FAILED')),
  error text,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  verified_scan text,
  UNIQUE(label_id,attempt_no)
);

ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records(expires_at);

DROP TABLE IF EXISTS site_snapshots;
