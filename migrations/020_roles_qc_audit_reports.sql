CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES sites(id), code text NOT NULL,
  name text NOT NULL, built_in boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,code)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission text NOT NULL,
  PRIMARY KEY(role_id,permission)
);
CREATE TABLE IF NOT EXISTS user_roles (
  site_id uuid NOT NULL REFERENCES sites(id), user_id uuid NOT NULL REFERENCES users(id),
  role_id uuid NOT NULL REFERENCES roles(id), PRIMARY KEY(site_id,user_id,role_id)
);

CREATE TABLE IF NOT EXISTS qc_checklists (
  id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES sites(id), code text NOT NULL,
  product text NOT NULL, stage text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,code)
);
CREATE TABLE IF NOT EXISTS qc_checklist_items (
  id uuid PRIMARY KEY, checklist_id uuid NOT NULL REFERENCES qc_checklists(id) ON DELETE CASCADE,
  code text NOT NULL, prompt text NOT NULL, required boolean NOT NULL DEFAULT true, sequence_no integer NOT NULL,
  UNIQUE(checklist_id,code), UNIQUE(checklist_id,sequence_no)
);
ALTER TABLE quality_checks ADD COLUMN IF NOT EXISTS checklist_id uuid REFERENCES qc_checklists(id);
ALTER TABLE quality_checks ADD COLUMN IF NOT EXISTS responses jsonb NOT NULL DEFAULT '[]';
ALTER TABLE quality_checks ADD COLUMN IF NOT EXISTS attestation jsonb;
ALTER TABLE quality_checks ADD COLUMN IF NOT EXISTS corrective_task_id uuid REFERENCES tasks(id);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS before_state jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS after_state jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_roles jsonb NOT NULL DEFAULT '[]';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_station text;

ALTER TABLE packages ADD COLUMN IF NOT EXISTS terminal_reason text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS terminated_at timestamptz;
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_status_check;
ALTER TABLE packages ADD CONSTRAINT packages_status_check CHECK(status IN(
  'DRAFT','PACKING','READY_FOR_LABEL','PRINTING','LABEL_PENDING','LABEL_PRINTED','READY_TO_SHIP','SHIPPED','CANCELLED','DAMAGED'
));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS state_history jsonb NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reassigned_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reassigned_from uuid;
