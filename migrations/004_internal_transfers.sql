CREATE TABLE IF NOT EXISTS internal_transfers (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  source_site text NOT NULL,
  shipment_code text NOT NULL,
  received_by uuid,
  manifest jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE(site_id,source_site,shipment_code)
);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS source_transfer text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS external_parents jsonb NOT NULL DEFAULT '[]';
