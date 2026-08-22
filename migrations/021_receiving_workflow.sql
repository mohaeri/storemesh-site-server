CREATE TABLE IF NOT EXISTS harvest_periods (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,code),
  CHECK(start_date<=end_date)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code text NOT NULL,
  supplier_code text NOT NULL,
  status text NOT NULL CHECK(status IN('OPEN','COMPLETED','CANCELLED')),
  session_id uuid REFERENCES operational_sessions(id) ON DELETE SET NULL,
  receiving_batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE(site_id,code)
);

CREATE TABLE IF NOT EXISTS delivery_baskets (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES batches(id),
  container_id uuid NOT NULL REFERENCES containers(id),
  sequence_no integer NOT NULL,
  weight_kg numeric(14,3) NOT NULL CHECK(weight_kg>0),
  received_at timestamptz NOT NULL,
  UNIQUE(delivery_id,container_id),
  UNIQUE(delivery_id,sequence_no)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_code_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS users_site_badge_code_hash_uq
  ON users(site_id,badge_code_hash) WHERE badge_code_hash IS NOT NULL;

ALTER TABLE containers ADD COLUMN IF NOT EXISTS designated_zone text;
ALTER TABLE operational_sessions ADD COLUMN IF NOT EXISTS selected_role text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_aggregate boolean NOT NULL DEFAULT false;
