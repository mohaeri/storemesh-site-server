ALTER TABLE internal_transfers
  ADD COLUMN IF NOT EXISTS batch_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE internal_transfers AS transfer
SET batch_ids = COALESCE((
  SELECT array_agg(batch.id ORDER BY batch.id)
  FROM batches AS batch
  WHERE batch.source_transfer = transfer.shipment_code
), '{}')
WHERE transfer.batch_ids = '{}';
