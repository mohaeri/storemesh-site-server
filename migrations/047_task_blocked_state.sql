ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_by_exception_id uuid REFERENCES operational_exceptions(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS unblocked_status text;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN('OPEN','IN_PROGRESS','PAUSED','BLOCKED','FAILED','COMPLETED'));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_unblocked_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_unblocked_status_check CHECK(unblocked_status IS NULL OR unblocked_status IN('OPEN','IN_PROGRESS'));
