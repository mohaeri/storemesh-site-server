ALTER TABLE batches ADD COLUMN IF NOT EXISTS harvest_periods jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE batches SET harvest_periods=jsonb_build_array(harvest_period) WHERE harvest_period IS NOT NULL AND harvest_periods='[]'::jsonb;

ALTER TABLE processing_cycles ADD COLUMN IF NOT EXISTS input_weight_kg numeric(14,3);
UPDATE processing_cycles c SET input_weight_kg=(SELECT COALESCE(SUM(b.weight_kg),0) FROM batches b WHERE b.id=ANY(c.batch_ids)) WHERE input_weight_kg IS NULL;
ALTER TABLE processing_cycles ADD CONSTRAINT processing_cycles_input_weight_positive CHECK (input_weight_kg IS NULL OR input_weight_kg>0);
