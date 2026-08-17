CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  before_kg numeric(14,3) NOT NULL,
  delta_kg numeric(14,3) NOT NULL CHECK(delta_kg <> 0),
  after_kg numeric(14,3) NOT NULL CHECK(after_kg >= 0),
  reason_code text NOT NULL,
  reason text NOT NULL,
  user_id text,
  created_at timestamptz NOT NULL
);
