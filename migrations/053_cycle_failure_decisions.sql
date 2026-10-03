ALTER TABLE processing_cycles
  ADD COLUMN IF NOT EXISTS failure_decisions jsonb NOT NULL DEFAULT '[]'::jsonb;
