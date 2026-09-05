ALTER TABLE carton_scan_events
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE carton_scan_events
  DROP CONSTRAINT IF EXISTS carton_scan_events_item_identity_key;

CREATE UNIQUE INDEX IF NOT EXISTS carton_scan_events_active_identity_key
  ON carton_scan_events(item_identity)
  WHERE active;
