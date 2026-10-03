ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS suppliers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supplier_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supplier_contributions JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE batches
SET suppliers=jsonb_build_array(supplier),
    supplier_ids=ARRAY[supplier_id],
    supplier_contributions=jsonb_build_array(jsonb_build_object(
      'supplierId',supplier_id,
      'supplier',supplier,
      'contributedWeightKg',weight_kg
    ))
WHERE supplier IS NOT NULL AND supplier_id IS NOT NULL AND suppliers='[]'::jsonb;
