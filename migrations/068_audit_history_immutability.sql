CREATE OR REPLACE FUNCTION enforce_append_only_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE=TG_TABLE_NAME || ' is append-only';
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.archiving', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE=TG_TABLE_NAME || ' may only be deleted during guarded archival';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION enforce_append_only_history();

DROP TRIGGER IF EXISTS event_history_archive_append_only ON event_history_archive;
CREATE TRIGGER event_history_archive_append_only BEFORE UPDATE OR DELETE ON event_history_archive FOR EACH ROW EXECUTE FUNCTION enforce_append_only_history();
