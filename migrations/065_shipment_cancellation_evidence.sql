ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_session_id uuid REFERENCES operational_sessions(id),
  ADD COLUMN IF NOT EXISTS cancelled_device_id text;
