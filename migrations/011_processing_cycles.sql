CREATE TABLE IF NOT EXISTS processing_cycles (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  type text NOT NULL CHECK (type IN ('FREEZE','FREEZE_DRY','DRY')),
  machine_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES operational_sessions(id),
  device_id text NOT NULL,
  operator_id text NOT NULL,
  status text NOT NULL,
  state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_version_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE(site_id, code)
);

CREATE TABLE IF NOT EXISTS processing_cycle_containers (
  cycle_id uuid NOT NULL REFERENCES processing_cycles(id),
  container_id uuid NOT NULL REFERENCES containers(id),
  load_sequence integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(cycle_id, container_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_cycle_per_container_idx
ON processing_cycle_containers(container_id) WHERE active;
