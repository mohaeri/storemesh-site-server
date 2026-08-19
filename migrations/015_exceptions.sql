CREATE TABLE IF NOT EXISTS operational_exceptions (
  id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),type text NOT NULL,entity_type text NOT NULL,entity_id uuid,
  severity text NOT NULL CHECK(severity IN ('INFO','WARNING','HIGH','CRITICAL')),
  status text NOT NULL CHECK(status IN ('OPEN','ASSIGNED','RESOLVED','DISMISSED')),
  assigned_to text,raised_at timestamptz NOT NULL,resolved_at timestamptz,resolved_by text,resolution_note text
);
CREATE INDEX IF NOT EXISTS operational_exceptions_open_idx ON operational_exceptions(site_id,status,severity,raised_at);
