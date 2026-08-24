CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  contact text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  UNIQUE(site_id, code)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  status text NOT NULL DEFAULT 'OPEN',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  UNIQUE(site_id, code)
);

ALTER TABLE shipments ALTER COLUMN destination_site DROP NOT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loaded_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE TABLE IF NOT EXISTS shipment_carton_scans (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  package_id uuid NOT NULL REFERENCES packages(id),
  package_code text NOT NULL,
  session_id uuid NOT NULL REFERENCES operational_sessions(id),
  device_id text NOT NULL,
  sequence_no integer NOT NULL CHECK(sequence_no > 0),
  scanned_at timestamptz NOT NULL,
  UNIQUE(shipment_id, package_id),
  UNIQUE(shipment_id, sequence_no)
);
