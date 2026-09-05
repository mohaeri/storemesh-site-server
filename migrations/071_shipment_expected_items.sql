ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS expected_package_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expected_shipping_box_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE shipments shipment
SET expected_package_ids = package_ids.ids
FROM (
  SELECT shipment_id, array_agg(id ORDER BY id) AS ids
  FROM packages
  WHERE shipment_id IS NOT NULL
  GROUP BY shipment_id
) package_ids
WHERE shipment.id = package_ids.shipment_id
  AND cardinality(shipment.expected_package_ids) = 0;

UPDATE shipments shipment
SET expected_shipping_box_ids = box_ids.ids
FROM (
  SELECT shipment_id, array_agg(id ORDER BY id) AS ids
  FROM fresh_shipping_boxes
  WHERE shipment_id IS NOT NULL
  GROUP BY shipment_id
) box_ids
WHERE shipment.id = box_ids.shipment_id
  AND cardinality(shipment.expected_shipping_box_ids) = 0;
