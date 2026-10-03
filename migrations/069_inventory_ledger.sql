CREATE TABLE IF NOT EXISTS inventory_ledger (
  id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  delta NUMERIC(14,3) NOT NULL,
  reason TEXT NOT NULL,
  before_qty NUMERIC(14,3) NOT NULL,
  after_qty NUMERIC(14,3) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  session_id UUID,
  device_id TEXT NOT NULL,
  site_id UUID NOT NULL REFERENCES sites(id)
  ,sequence BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS inventory_ledger_entity_idx
  ON inventory_ledger(site_id, entity_type, entity_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_site_sequence_idx ON inventory_ledger(site_id, sequence);

DROP TRIGGER IF EXISTS inventory_ledger_append_only ON inventory_ledger;
CREATE TRIGGER inventory_ledger_append_only
BEFORE UPDATE OR DELETE ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION enforce_append_only_history();
