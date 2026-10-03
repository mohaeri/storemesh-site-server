ALTER TABLE inventory_ledger
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS movement_type text;

DROP TRIGGER IF EXISTS inventory_ledger_append_only ON inventory_ledger;

UPDATE inventory_ledger
SET user_id=COALESCE(user_id,'SYSTEM'),
    unit=COALESCE(unit,'KG'),
    movement_type=COALESCE(movement_type,reason)
WHERE user_id IS NULL OR unit IS NULL OR movement_type IS NULL;

ALTER TABLE inventory_ledger
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN unit SET NOT NULL,
  ALTER COLUMN movement_type SET NOT NULL;

CREATE TRIGGER inventory_ledger_append_only
BEFORE UPDATE OR DELETE ON inventory_ledger
FOR EACH ROW EXECUTE FUNCTION enforce_append_only_history();
