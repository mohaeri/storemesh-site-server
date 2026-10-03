ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loaded_by text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loaded_session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loaded_device_id text;
