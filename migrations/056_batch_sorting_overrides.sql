ALTER TABLE batches ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('NORMAL','HIGH','URGENT'));
ALTER TABLE batches ADD COLUMN IF NOT EXISTS priority_reason text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS priority_updated_at timestamptz;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS grade_override jsonb;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS destination_override jsonb;
