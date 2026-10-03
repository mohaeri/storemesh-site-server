ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS settlement_reference text;
