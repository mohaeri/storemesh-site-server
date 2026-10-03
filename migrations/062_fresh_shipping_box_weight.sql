ALTER TABLE fresh_shipping_boxes
  ADD COLUMN IF NOT EXISTS measured_weight_kg numeric(14,3),
  ADD COLUMN IF NOT EXISTS weight_measurement_id uuid REFERENCES measurements(id);
