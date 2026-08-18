ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  user_id text,
  device_id text,
  status text NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','REVOKED','LOGGED_OUT')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text
);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'SUCCESS';
