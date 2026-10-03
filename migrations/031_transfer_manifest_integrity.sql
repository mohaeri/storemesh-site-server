ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manifest_nonce uuid;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dispatch_scan jsonb;

ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS receipt_scan jsonb;

