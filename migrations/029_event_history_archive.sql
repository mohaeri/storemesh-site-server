CREATE TABLE IF NOT EXISTS event_history_archive (
  event_kind text NOT NULL CHECK (event_kind IN ('AUDIT','OUTBOX')),
  event_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES sites(id),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_kind,event_id)
);

CREATE INDEX IF NOT EXISTS event_history_archive_site_time_idx
  ON event_history_archive(site_id,event_kind,occurred_at);
