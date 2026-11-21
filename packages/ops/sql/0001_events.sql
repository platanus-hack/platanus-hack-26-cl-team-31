-- ops.events: telemetría de todos los servicios. Solo se agrega (append-only).
-- La escribe @team-31/telemetry y la lee el admin a través de vistas ops.v_*.
-- attrs ya viene validado por el catálogo de eventos: nunca contiene secretos ni texto libre.
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.events (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  service        text NOT NULL CHECK (service IN ('web', 'mcp', 'broker', 'worker', 'admin', 'coordination')),
  instance       text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('http', 'tool', 'lifecycle', 'wake', 'policy', 'auth', 'error', 'admin')),
  name           text NOT NULL,
  level          text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  trace_id       text,
  span_id        text,
  parent_span_id text,
  request_id     text,
  user_id        text,
  agent_id       text,
  duration_ms    integer,
  status         text,
  error_id       uuid,
  attrs          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(attrs) <= 8192)
);

CREATE INDEX IF NOT EXISTS events_at_idx         ON ops.events (at DESC);
CREATE INDEX IF NOT EXISTS events_trace_idx      ON ops.events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_request_idx    ON ops.events (request_id, id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_user_idx       ON ops.events (user_id, at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_kind_name_idx  ON ops.events (kind, name, at DESC);
CREATE INDEX IF NOT EXISTS events_error_idx      ON ops.events (error_id) WHERE error_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_service_at_idx ON ops.events (service, at DESC);
