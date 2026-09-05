ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS receiving_container_previous_status text,
  ADD COLUMN IF NOT EXISTS receiving_container_previous_active_session_id uuid,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_session_id uuid,
  ADD COLUMN IF NOT EXISTS cancelled_device_id text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
