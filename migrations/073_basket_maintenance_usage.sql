ALTER TABLE containers
  ADD COLUMN IF NOT EXISTS receiving_use_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maintenance_warning_raised boolean NOT NULL DEFAULT false;

ALTER TABLE operational_exceptions
  ADD COLUMN IF NOT EXISTS supervisor_only boolean NOT NULL DEFAULT false;
