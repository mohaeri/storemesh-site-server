ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_type text;

CREATE INDEX IF NOT EXISTS audit_entity_type_id_idx
  ON audit_events(site_id, entity_type, entity_id, occurred_at);
