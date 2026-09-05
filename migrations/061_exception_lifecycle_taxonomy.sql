ALTER TABLE operational_exceptions DROP CONSTRAINT IF EXISTS operational_exceptions_status_check;
ALTER TABLE operational_exceptions ADD CONSTRAINT operational_exceptions_status_check CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','DISMISSED','CLOSED'));
ALTER TABLE operational_exceptions
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS production_area text,
  ADD COLUMN IF NOT EXISTS machine_id text,
  ADD COLUMN IF NOT EXISTS product text,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS shipment_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_by text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS root_cause text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS preventive_action text;
CREATE INDEX IF NOT EXISTS operational_exceptions_search_idx ON operational_exceptions(site_id,status,severity,category,raised_at);
