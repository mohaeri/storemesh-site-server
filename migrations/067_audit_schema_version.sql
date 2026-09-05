ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 2;
