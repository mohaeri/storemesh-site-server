ALTER TABLE processing_cycle_containers
  DROP CONSTRAINT IF EXISTS processing_cycle_containers_cycle_id_fkey;

ALTER TABLE processing_cycle_containers
  ADD CONSTRAINT processing_cycle_containers_cycle_id_fkey
  FOREIGN KEY (cycle_id) REFERENCES processing_cycles(id) ON DELETE CASCADE;
