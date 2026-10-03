ALTER TABLE batches ADD COLUMN IF NOT EXISTS loss_reason text;

ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_loss_reason_check;
ALTER TABLE batches ADD CONSTRAINT batches_loss_reason_check CHECK (
  loss_reason IS NULL OR loss_reason IN ('WASTE','DAMAGE','MOISTURE_LOSS','RESIDUAL_MATERIAL','MEASUREMENT_VARIANCE')
);
