ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS sequence bigint;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY site_id ORDER BY occurred_at, id) AS sequence
  FROM audit_events WHERE sequence IS NULL
)
UPDATE audit_events event SET sequence=numbered.sequence FROM numbered WHERE numbered.id=event.id;

CREATE INDEX IF NOT EXISTS audit_events_site_sequence_idx ON audit_events(site_id, sequence);
