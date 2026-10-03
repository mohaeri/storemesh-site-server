ALTER TABLE quality_checks
  ADD COLUMN IF NOT EXISTS previous_corrective_task_id uuid REFERENCES tasks(id);
