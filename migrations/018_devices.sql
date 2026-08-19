CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,type text NOT NULL,
  status text NOT NULL CHECK(status IN('ACTIVE','RETIRED')),assigned_station text,last_seen_at timestamptz,created_at timestamptz NOT NULL,
  UNIQUE(site_id,code)
);
CREATE INDEX IF NOT EXISTS devices_status_idx ON devices(site_id,status,last_seen_at);
