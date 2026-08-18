ALTER TABLE operational_sessions ADD COLUMN IF NOT EXISTS device_id text;
UPDATE operational_sessions SET device_id='LEGACY-UNKNOWN' WHERE device_id IS NULL;
ALTER TABLE operational_sessions ALTER COLUMN device_id SET NOT NULL;

ALTER TABLE containers ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS active_session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS last_device_id text;

ALTER TABLE batches ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT 'SYSTEM';

CREATE INDEX IF NOT EXISTS containers_active_session_idx ON containers(active_session_id) WHERE active_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_device_idx ON audit_events(site_id,device_id,occurred_at DESC);
