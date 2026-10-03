ALTER TABLE quality_checks
  ADD COLUMN IF NOT EXISTS exception_id uuid REFERENCES operational_exceptions(id);

CREATE INDEX IF NOT EXISTS quality_checks_exception_idx
  ON quality_checks(exception_id)
  WHERE exception_id IS NOT NULL;
