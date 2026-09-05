ALTER TABLE inventory_movements
  ALTER COLUMN batch_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS container_id uuid REFERENCES containers(id),
  ADD COLUMN IF NOT EXISTS quantity_kg numeric,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'KG',
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS object_type text,
  ADD COLUMN IF NOT EXISTS movement_type text,
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movement_object_required
  CHECK (batch_id IS NOT NULL OR container_id IS NOT NULL);

