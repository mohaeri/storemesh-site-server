ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS category text;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;

UPDATE audit_events
SET category = CASE
  WHEN event_type ~ 'PERMISSION|RATE_LIMIT|PAYLOAD_TOO_LARGE|SECURITY' THEN 'Security'
  WHEN event_type ~ 'LOGIN|AUTH_SESSION|SESSION_' THEN 'Authentication'
  WHEN event_type ~ 'LABEL|PRINT' THEN 'Labeling'
  WHEN event_type ~ 'EXCEPTION|QUARANTINE|QUALITY|(^|_)QC(_|$)|REQUEST_VALIDATION_FAILED|RESOURCE_NOT_FOUND|SYSTEM_FAILURE' THEN 'Exceptions'
  WHEN event_type ~ 'CONFIGURATION|OVERRIDE' THEN 'Configuration'
  WHEN event_type ~ 'SHIPMENT|TRANSFER|DELIVERY_ACKNOWLEDGMENT' THEN 'Shipping'
  WHEN event_type ~ 'PACKAGE|PACKAGING|CARTON|FRESH_NET|SHIPPING_BOX' THEN 'Packaging'
  WHEN event_type ~ 'CYCLE|SORT|WASH|SLICE|FREEZ|DRY|YIELD|HARVEST|MACHINE|MEASUREMENT' THEN 'Production'
  WHEN event_type ~ 'INVENTORY|BATCH|CONTAINER|DELIVERY|RECEIV|MOVEMENT|CONSUMABLE|STORAGE|FIFO|TRACE' THEN 'Inventory'
  ELSE 'Administration'
END
WHERE category IS NULL;

ALTER TABLE audit_events ALTER COLUMN category SET NOT NULL;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_category_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_category_check CHECK (category IN ('Authentication','Inventory','Production','Packaging','Shipping','Labeling','Exceptions','Configuration','Administration','Security'));

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION enforce_append_only_history();

CREATE INDEX IF NOT EXISTS audit_category_occurred_at_idx
  ON audit_events(site_id, category, occurred_at);
