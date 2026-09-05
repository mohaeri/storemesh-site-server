ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS yield_percent numeric(8,3),
  ADD COLUMN IF NOT EXISTS process_loss_kg numeric(14,3),
  ADD COLUMN IF NOT EXISTS weight_gain_kg numeric(14,3),
  ADD COLUMN IF NOT EXISTS sorting_loss_kg numeric(14,3),
  ADD COLUMN IF NOT EXISTS pre_quarantine_status text,
  ADD COLUMN IF NOT EXISTS pre_quarantine_zone text;

ALTER TABLE processing_cycles
  ADD COLUMN IF NOT EXISTS batch_ids uuid[] NOT NULL DEFAULT '{}';
