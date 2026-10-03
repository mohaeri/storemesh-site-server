ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS print_point text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS label_object_type text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS label_template_id text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS label_template_snapshot jsonb;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS label_assignment_id text;
ALTER TABLE print_attempts ADD COLUMN IF NOT EXISTS workstation_device_id text;

CREATE INDEX IF NOT EXISTS print_attempts_routing_idx
  ON print_attempts(print_point, workstation_device_id, requested_at);
