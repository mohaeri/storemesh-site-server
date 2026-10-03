ALTER TABLE print_attempts
  ADD COLUMN IF NOT EXISTS retry_reason text;

