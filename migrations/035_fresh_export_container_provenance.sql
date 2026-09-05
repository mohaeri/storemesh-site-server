ALTER TABLE fresh_net_lots
  ADD COLUMN IF NOT EXISTS container_id uuid REFERENCES containers(id);
