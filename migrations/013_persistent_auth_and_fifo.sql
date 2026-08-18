ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS fifo_warning boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS recommended_batch_id uuid REFERENCES batches(id);
