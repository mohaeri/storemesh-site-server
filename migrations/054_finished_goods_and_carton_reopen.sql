ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_location text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_operator_id text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_device_id text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_moved_at timestamptz;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS warehouse_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_site_id_entity_type_entity_id_key;
ALTER TABLE print_attempts DROP CONSTRAINT IF EXISTS print_attempts_status_check;
ALTER TABLE print_attempts ADD CONSTRAINT print_attempts_status_check CHECK(status IN ('PENDING','PRINTED','FAILED','VOID'));
