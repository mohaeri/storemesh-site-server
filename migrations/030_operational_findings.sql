ALTER TABLE containers ADD COLUMN IF NOT EXISTS designated_zones jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS tare_weight_kg numeric(12,3);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS single_use boolean NOT NULL DEFAULT false;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS cleaning_status text NOT NULL DEFAULT 'CLEAN';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS has_washed_history boolean NOT NULL DEFAULT false;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_requested boolean NOT NULL DEFAULT false;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS gross_weight_kg numeric(12,3);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS tare_weight_kg numeric(12,3);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS container_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS container_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cold_storage_moved_at timestamptz;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS product_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sizes ADD COLUMN IF NOT EXISTS product_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO zones(id,site_id,code,name,status)
SELECT gen_random_uuid(),s.id,z.code,z.name,'ACTIVE'
FROM sites s CROSS JOIN (VALUES
  ('COLD_ROOM_CLEAN','Clean Cold Room'),
  ('COLD_ROOM_DIRTY','Dirty Cold Room'),
  ('FRESH_EXPORT','Fresh Export')
) AS z(code,name)
ON CONFLICT(site_id,code) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE';
UPDATE zones SET status='INACTIVE' WHERE code='COLD_ROOM';

CREATE TABLE IF NOT EXISTS consumables(
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'EA',
  quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(quantity>=0),
  reorder_threshold numeric(14,3) NOT NULL DEFAULT 0 CHECK(reorder_threshold>=0),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL,
  UNIQUE(site_id,code)
);
CREATE TABLE IF NOT EXISTS consumable_receipts(
  id uuid PRIMARY KEY,
  consumable_id uuid NOT NULL REFERENCES consumables(id),
  quantity numeric(14,3) NOT NULL CHECK(quantity>0),
  source text NOT NULL,
  received_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS consumable_transactions(
  id uuid PRIMARY KEY,
  consumable_id uuid NOT NULL REFERENCES consumables(id),
  type text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  balance numeric(14,3) NOT NULL,
  reason text,
  entity_id uuid,
  occurred_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS fresh_net_lots(
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  batch_id uuid NOT NULL REFERENCES batches(id),
  product text NOT NULL,
  grade text NOT NULL,
  size text NOT NULL,
  unit_weight_kg numeric(12,3) NOT NULL CHECK(unit_weight_kg>0),
  count integer NOT NULL CHECK(count>0),
  total_weight_kg numeric(12,3) NOT NULL CHECK(total_weight_kg>0),
  remaining_count integer NOT NULL CHECK(remaining_count>=0),
  session_id uuid REFERENCES operational_sessions(id),
  device_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id,code)
);
CREATE TABLE IF NOT EXISTS fresh_shipping_boxes(
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  status text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_id uuid REFERENCES operational_sessions(id),
  device_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(site_id,code)
);
