ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_location text;
ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_operator_id text;
ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_session_id uuid REFERENCES operational_sessions(id);
ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_device_id text;
ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_moved_at timestamptz;
ALTER TABLE fresh_shipping_boxes ADD COLUMN IF NOT EXISTS warehouse_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE inventory_adjustments ALTER COLUMN batch_id DROP NOT NULL;
ALTER TABLE inventory_adjustments ALTER COLUMN before_kg DROP NOT NULL;
ALTER TABLE inventory_adjustments ALTER COLUMN delta_kg DROP NOT NULL;
ALTER TABLE inventory_adjustments ALTER COLUMN after_kg DROP NOT NULL;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS adjustment_type text NOT NULL DEFAULT 'WEIGHT';
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS item_type text;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS item_id uuid;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS before_location text;
ALTER TABLE inventory_adjustments ADD COLUMN IF NOT EXISTS after_location text;
