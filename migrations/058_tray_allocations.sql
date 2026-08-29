CREATE TABLE IF NOT EXISTS tray_allocations(
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  batch_id uuid NOT NULL REFERENCES batches(id),
  tray_id uuid NOT NULL REFERENCES containers(id),
  tray_number text NOT NULL,
  quantity_kg numeric(12,3),
  tray_sequence integer NOT NULL CHECK(tray_sequence > 0),
  session_id uuid NOT NULL REFERENCES operational_sessions(id),
  device_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(batch_id,tray_id),
  UNIQUE(batch_id,tray_sequence)
);
