ALTER TABLE tasks ADD COLUMN IF NOT EXISTS operation_type text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reassignment_reason text;
