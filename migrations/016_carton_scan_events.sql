CREATE TABLE IF NOT EXISTS carton_scan_events (
  id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES packages(id),
  batch_id uuid NOT NULL REFERENCES batches(id), item_identity text NOT NULL,
  weight_kg numeric(12,3) NOT NULL CHECK(weight_kg>0), scanned_at timestamptz NOT NULL,
  session_id uuid NOT NULL REFERENCES operational_sessions(id), device_id text NOT NULL,
  sequence_no integer NOT NULL CHECK(sequence_no>0),
  UNIQUE(package_id,item_identity), UNIQUE(package_id,sequence_no), UNIQUE(item_identity)
);
CREATE INDEX IF NOT EXISTS carton_scan_events_package_idx ON carton_scan_events(package_id,sequence_no);
