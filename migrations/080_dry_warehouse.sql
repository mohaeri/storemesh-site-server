INSERT INTO zones(id,site_id,code,name,status)
SELECT gen_random_uuid(),site.id,'DRY_WAREHOUSE','انبار خشک','ACTIVE'
FROM sites AS site
ON CONFLICT(site_id,code) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE';
