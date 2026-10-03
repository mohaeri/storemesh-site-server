ALTER TABLE quality_checks
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id text;
