ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancelled_reason text;
