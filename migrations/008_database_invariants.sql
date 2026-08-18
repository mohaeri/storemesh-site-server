ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_weight_nonnegative;
ALTER TABLE batches ADD CONSTRAINT batches_weight_nonnegative CHECK(weight_kg >= 0);

CREATE OR REPLACE FUNCTION enforce_container_invariants() RETURNS trigger AS $$
DECLARE c containers%ROWTYPE; used numeric; conflicting boolean;
BEGIN
  IF NEW.container_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM containers WHERE id=NEW.container_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Container does not exist'; END IF;
  SELECT COALESCE(sum(weight_kg),0) INTO used FROM batches WHERE container_id=NEW.container_id AND id<>NEW.id;
  IF used+NEW.weight_kg>c.capacity_kg THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Container capacity exceeded'; END IF;
  IF c.stage='PRE_SORT' THEN
    SELECT EXISTS(SELECT 1 FROM batches WHERE container_id=NEW.container_id AND id<>NEW.id AND product<>NEW.product) INTO conflicting;
    IF conflicting THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pre-sort container may hold only one product'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batches_container_invariants ON batches;
CREATE TRIGGER batches_container_invariants BEFORE INSERT OR UPDATE OF container_id,weight_kg,product ON batches FOR EACH ROW EXECUTE FUNCTION enforce_container_invariants();

CREATE OR REPLACE FUNCTION enforce_container_capacity_change() RETURNS trigger AS $$
DECLARE used numeric;
BEGIN
  SELECT COALESCE(sum(weight_kg),0) INTO used FROM batches WHERE container_id=NEW.id;
  IF used>NEW.capacity_kg THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Capacity is below contained inventory'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS containers_capacity_invariant ON containers;
CREATE TRIGGER containers_capacity_invariant BEFORE UPDATE OF capacity_kg ON containers FOR EACH ROW EXECUTE FUNCTION enforce_container_capacity_change();
