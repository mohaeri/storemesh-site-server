ALTER TABLE containers ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('NORMAL','HIGH','URGENT'));
ALTER TABLE containers ADD COLUMN IF NOT EXISTS priority_reason text;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS priority_updated_at timestamptz;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS damage_reason text;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS damaged_at timestamptz;
