ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_container_id uuid REFERENCES containers(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS target_container_id uuid REFERENCES containers(id);
