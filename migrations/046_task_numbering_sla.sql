ALTER TABLE tasks ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expected_duration_minutes integer;

WITH numbered AS (
  SELECT t.id, s.code AS site_code,
         row_number() OVER (PARTITION BY t.site_id ORDER BY t.created_at, t.id) AS sequence
  FROM tasks t JOIN sites s ON s.id=t.site_id
  WHERE t.code IS NULL
)
UPDATE tasks t
SET code='T-' || numbered.site_code || '-' || lpad(numbered.sequence::text, 6, '0')
FROM numbered WHERE numbered.id=t.id;

ALTER TABLE tasks ALTER COLUMN code SET NOT NULL;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_expected_duration_positive;
ALTER TABLE tasks ADD CONSTRAINT tasks_expected_duration_positive CHECK(expected_duration_minutes IS NULL OR expected_duration_minutes > 0);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_site_code_unique ON tasks(site_id, code);
