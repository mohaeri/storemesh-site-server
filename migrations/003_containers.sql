CREATE TABLE IF NOT EXISTS containers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  type text NOT NULL,
  capacity_kg numeric(14,3) NOT NULL CHECK(capacity_kg > 0),
  zone text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id,code)
);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS container_id uuid REFERENCES containers(id);
CREATE INDEX IF NOT EXISTS batches_container_idx ON batches(container_id) WHERE container_id IS NOT NULL;
