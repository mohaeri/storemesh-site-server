ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS leased_device_id text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS lease_session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS leased_at timestamptz;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS print_attempts_pending_lease_idx ON print_attempts(status,lease_expires_at) WHERE status='PENDING';
ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_status_check;
ALTER TABLE labels ADD CONSTRAINT labels_status_check CHECK(status IN ('PENDING','VERIFIED','PRINTED','VOID'));
