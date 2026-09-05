ALTER TABLE fresh_shipping_boxes
  ADD COLUMN IF NOT EXISTS terminal_reason text,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz;

ALTER TABLE fresh_net_lots
  ADD COLUMN IF NOT EXISTS source_contributions jsonb NOT NULL DEFAULT '[]'::jsonb;
