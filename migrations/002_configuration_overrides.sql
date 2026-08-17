CREATE TABLE IF NOT EXISTS configuration_versions (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  scope text NOT NULL,
  sequence integer NOT NULL,
  status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','ACTIVE','RETIRED')),
  values jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  UNIQUE(site_id,scope,sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_configuration_per_scope ON configuration_versions(site_id,scope) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS manager_overrides (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  rule_code text NOT NULL,
  entity_id uuid,
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK(resolved_by IS NULL OR resolved_by <> requested_by)
);
