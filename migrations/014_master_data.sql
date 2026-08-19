CREATE TABLE IF NOT EXISTS products (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));
CREATE TABLE IF NOT EXISTS suppliers (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));
CREATE TABLE IF NOT EXISTS grades (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));
CREATE TABLE IF NOT EXISTS sizes (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));
CREATE TABLE IF NOT EXISTS zones (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));
CREATE TABLE IF NOT EXISTS package_types (id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES sites(id),code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(site_id,code));

INSERT INTO products SELECT md5(site_id::text||':PRODUCT:'||product)::uuid,site_id,product,product,'ACTIVE' FROM batches GROUP BY site_id,product ON CONFLICT DO NOTHING;
INSERT INTO suppliers SELECT md5(site_id::text||':SUPPLIER:'||supplier)::uuid,site_id,supplier,supplier,'ACTIVE' FROM batches WHERE supplier IS NOT NULL GROUP BY site_id,supplier ON CONFLICT DO NOTHING;
INSERT INTO grades SELECT md5(site_id::text||':GRADE:'||grade)::uuid,site_id,grade,grade,'ACTIVE' FROM batches GROUP BY site_id,grade ON CONFLICT DO NOTHING;
INSERT INTO sizes SELECT md5(site_id::text||':SIZE:'||size)::uuid,site_id,size,size,'ACTIVE' FROM batches GROUP BY site_id,size ON CONFLICT DO NOTHING;
INSERT INTO zones SELECT md5(site_id::text||':ZONE:'||zone)::uuid,site_id,zone,zone,'ACTIVE' FROM batches GROUP BY site_id,zone ON CONFLICT DO NOTHING;
INSERT INTO zones SELECT md5(site_id::text||':ZONE:'||zone)::uuid,site_id,zone,zone,'ACTIVE' FROM containers GROUP BY site_id,zone ON CONFLICT DO NOTHING;
INSERT INTO package_types SELECT md5(site_id::text||':PACKAGE_TYPE:'||type)::uuid,site_id,type,type,'ACTIVE' FROM packages GROUP BY site_id,type ON CONFLICT DO NOTHING;

ALTER TABLE batches ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id),ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES grades(id),ADD COLUMN IF NOT EXISTS size_id uuid REFERENCES sizes(id),ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS package_type_id uuid REFERENCES package_types(id);
UPDATE batches b SET product_id=p.id FROM products p WHERE p.site_id=b.site_id AND p.code=b.product AND b.product_id IS NULL;
UPDATE batches b SET supplier_id=s.id FROM suppliers s WHERE s.site_id=b.site_id AND s.code=b.supplier AND b.supplier_id IS NULL;
UPDATE batches b SET grade_id=g.id FROM grades g WHERE g.site_id=b.site_id AND g.code=b.grade AND b.grade_id IS NULL;
UPDATE batches b SET size_id=s.id FROM sizes s WHERE s.site_id=b.site_id AND s.code=b.size AND b.size_id IS NULL;
UPDATE batches b SET zone_id=z.id FROM zones z WHERE z.site_id=b.site_id AND z.code=b.zone AND b.zone_id IS NULL;
UPDATE containers c SET zone_id=z.id FROM zones z WHERE z.site_id=c.site_id AND z.code=c.zone AND c.zone_id IS NULL;
UPDATE packages p SET package_type_id=t.id FROM package_types t WHERE t.site_id=p.site_id AND t.code=p.type AND p.package_type_id IS NULL;
ALTER TABLE batches ALTER COLUMN product_id SET NOT NULL,ALTER COLUMN grade_id SET NOT NULL,ALTER COLUMN size_id SET NOT NULL,ALTER COLUMN zone_id SET NOT NULL;
ALTER TABLE containers ALTER COLUMN zone_id SET NOT NULL;
ALTER TABLE packages ALTER COLUMN package_type_id SET NOT NULL;

CREATE OR REPLACE FUNCTION resolve_batch_reference_ids() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  SELECT id INTO NEW.product_id FROM products WHERE site_id=NEW.site_id AND code=NEW.product AND status='ACTIVE';
  IF NEW.supplier IS NOT NULL THEN SELECT id INTO NEW.supplier_id FROM suppliers WHERE site_id=NEW.site_id AND code=NEW.supplier AND status='ACTIVE'; END IF;
  SELECT id INTO NEW.grade_id FROM grades WHERE site_id=NEW.site_id AND code=NEW.grade AND status='ACTIVE';
  SELECT id INTO NEW.size_id FROM sizes WHERE site_id=NEW.site_id AND code=NEW.size AND status='ACTIVE';
  SELECT id INTO NEW.zone_id FROM zones WHERE site_id=NEW.site_id AND code=NEW.zone AND status='ACTIVE';
  IF NEW.product_id IS NULL OR NEW.grade_id IS NULL OR NEW.size_id IS NULL OR NEW.zone_id IS NULL OR (NEW.supplier IS NOT NULL AND NEW.supplier_id IS NULL) THEN RAISE EXCEPTION 'inactive or unknown batch reference code' USING ERRCODE='23503'; END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION resolve_container_zone_id() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT id INTO NEW.zone_id FROM zones WHERE site_id=NEW.site_id AND code=NEW.zone AND status='ACTIVE';IF NEW.zone_id IS NULL THEN RAISE EXCEPTION 'inactive or unknown container zone' USING ERRCODE='23503';END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION resolve_package_type_id() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT id INTO NEW.package_type_id FROM package_types WHERE site_id=NEW.site_id AND code=NEW.type AND status='ACTIVE';IF NEW.package_type_id IS NULL THEN RAISE EXCEPTION 'inactive or unknown package type' USING ERRCODE='23503';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS batches_resolve_references ON batches;CREATE TRIGGER batches_resolve_references BEFORE INSERT OR UPDATE OF product,supplier,grade,size,zone ON batches FOR EACH ROW EXECUTE FUNCTION resolve_batch_reference_ids();
DROP TRIGGER IF EXISTS containers_resolve_zone ON containers;CREATE TRIGGER containers_resolve_zone BEFORE INSERT OR UPDATE OF zone ON containers FOR EACH ROW EXECUTE FUNCTION resolve_container_zone_id();
DROP TRIGGER IF EXISTS packages_resolve_type ON packages;CREATE TRIGGER packages_resolve_type BEFORE INSERT OR UPDATE OF type ON packages FOR EACH ROW EXECUTE FUNCTION resolve_package_type_id();
