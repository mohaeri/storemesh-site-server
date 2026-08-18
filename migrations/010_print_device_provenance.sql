ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS print_attempts_device_idx ON print_attempts(device_id,requested_at DESC) WHERE device_id IS NOT NULL;
