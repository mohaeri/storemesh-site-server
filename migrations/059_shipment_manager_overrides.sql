ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('NORMAL','HIGH','URGENT'));
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority_reason text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority_updated_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES shipments(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS merge_reason text;
