ALTER TABLE packages
  ALTER COLUMN warehouse_operator_id TYPE text USING warehouse_operator_id::text;
