ALTER TABLE fresh_shipping_boxes
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES shipments(id);

ALTER TABLE shipment_carton_scans
  ALTER COLUMN package_id DROP NOT NULL;

ALTER TABLE shipment_carton_scans
  ADD COLUMN IF NOT EXISTS shipping_box_id uuid REFERENCES fresh_shipping_boxes(id);

ALTER TABLE shipment_carton_scans
  DROP CONSTRAINT IF EXISTS shipment_carton_scans_shipment_id_package_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS shipment_scans_package_unique
  ON shipment_carton_scans(shipment_id, package_id)
  WHERE package_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shipment_scans_shipping_box_unique
  ON shipment_carton_scans(shipment_id, shipping_box_id)
  WHERE shipping_box_id IS NOT NULL;

ALTER TABLE shipment_carton_scans
  DROP CONSTRAINT IF EXISTS shipment_scan_exactly_one_item;

ALTER TABLE shipment_carton_scans
  ADD CONSTRAINT shipment_scan_exactly_one_item CHECK (
    (package_id IS NOT NULL AND shipping_box_id IS NULL) OR
    (package_id IS NULL AND shipping_box_id IS NOT NULL)
  );
