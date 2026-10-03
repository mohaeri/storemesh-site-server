ALTER TABLE packages ADD COLUMN IF NOT EXISTS measured_weight_kg numeric(14,3);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS target_weight_kg numeric(14,3);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS tolerance_percent numeric(7,3);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS device_id text;
