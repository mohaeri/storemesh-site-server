ALTER TABLE internal_transfers
  ADD COLUMN IF NOT EXISTS delivery_acknowledgment jsonb;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS delivery_receipt_id uuid,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_by text,
  ADD COLUMN IF NOT EXISTS delivery_acknowledgment jsonb;
