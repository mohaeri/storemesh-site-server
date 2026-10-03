ALTER TABLE operational_exceptions
  ADD COLUMN IF NOT EXISTS note text;
