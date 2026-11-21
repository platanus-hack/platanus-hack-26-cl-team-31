-- Vistas redactadas ops.v_*: la interfaz pública de lectura del admin (docs/admin.md#22-vistas-adm-02).
--
-- Las tablas siguen siendo privadas de cada módulo (nexo.* del broker, Better Auth, coordinación).
-- Estas vistas nunca exponen args, result, purpose, firmas, nonces, secretos de aviso ni tokens.
-- La única excepción es ops.v_request_payloads, que solo puede leer nexo_admin_reveal (0003).
--
-- Todas se crean dentro de ops.refresh_views(), que solo crea las vistas cuyas tablas de origen
-- existen (to_regclass). Así la migración no falla si ops migra antes que el broker, Better Auth
-- o la coordinación. Después de crear esas tablas, el dueño del esquema vuelve a ejecutar
-- `SELECT ops.refresh_views();` (es idempotente y reaplica los permisos de 0003).
-- La bitácora admin.audit (ADM-04) no tiene vista: nexo_admin_ro la lee directo (0003).
--
-- Las vistas usan los privilegios de su dueño: los roles del admin no necesitan acceso a las tablas.

CREATE OR REPLACE FUNCTION ops.refresh_views() RETURNS text[]
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $fn$
DECLARE
  created text[] := ARRAY[]::text[];
  -- Extrae solo el host de una URL (sin esquema, credenciales, puerto, ruta ni query).
  host_pattern constant text := '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]+\]|[^/:?#]+)';
BEGIN
  -- ---------- Telemetría (ops.events siempre existe: 0001) ----------

  EXECUTE $v$
    CREATE OR REPLACE VIEW ops.v_events AS
    SELECT id, at, service, instance, kind, name, level, trace_id, span_id, parent_span_id,
           request_id, user_id, agent_id, duration_ms, status, error_id, attrs
    FROM ops.events
  $v$;
  created := array_append(created, 'v_events');

  -- Último latido por servicio e instancia. service.started también cuenta como señal de vida.
  EXECUTE $v$
    CREATE OR REPLACE VIEW ops.v_service_health AS
    SELECT service, instance, version, last_seen_at,
           CASE
             WHEN last_seen_at > now() - interval '60 seconds' THEN 'up'
             WHEN last_seen_at > now() - interval '5 minutes' THEN 'stale'
             ELSE 'down'
           END AS state
    FROM (
      SELECT DISTINCT ON (service, instance)
             service, instance, attrs->>'version' AS version, at AS last_seen_at
      FROM ops.events
      WHERE kind = 'lifecycle' AND name IN ('service.heartbeat', 'service.started')
      ORDER BY service, instance, at DESC
    ) latest
  $v$;
  created := array_append(created, 'v_service_health');

  -- Errores agrupados por minuto: sumar los buckets de una ventana da el agrupado de esa ventana.
  EXECUTE $v$
    CREATE OR REPLACE VIEW ops.v_errors AS
    SELECT service,
           coalesce(attrs->>'operation', name) AS operation,
           coalesce(attrs->>'type', 'Error') AS type,
           date_trunc('minute', at) AS bucket,
           count(*) AS count,
           min(at) AS first_at,
           max(at) AS last_at,
           (array_agg(coalesce(error_id::text, id::text) ORDER BY at DESC, id DESC))[1] AS sample_error_id
    FROM ops.events
    WHERE kind = 'error'
    GROUP BY 1, 2, 3, 4
  $v$;
  created := array_append(created, 'v_errors');

  -- ---------- Broker (nexo.*) ----------

  IF to_regclass('nexo.requests') IS NOT NULL AND to_regclass('nexo.wake_jobs') IS NOT NULL THEN
    -- Sin args, result, purpose, firmas ni nonce: solo las llaves de args y result.
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_requests AS
      SELECT r.id, r.tool, r.from_address, r.to_address, r.from_user_id, r.to_user_id,
             r.status, r.outcome, r.rule, r.escalated, r.target_agent_id, r.answered_by_agent_id,
             r.allowed_fields,
             coalesce(r.dropped_fields, ARRAY[]::text[]) AS dropped_fields,
             r.decision_reason, r.internal_reason,
             CASE WHEN jsonb_typeof(r.args) = 'object'
                  THEN ARRAY(SELECT jsonb_object_keys(r.args) ORDER BY 1)
                  ELSE ARRAY[]::text[] END AS args_keys,
             CASE WHEN jsonb_typeof(r.result) = 'object'
                  THEN ARRAY(SELECT jsonb_object_keys(r.result) ORDER BY 1)
                  ELSE ARRAY[]::text[] END AS result_keys,
             coalesce(r.purpose, '') <> '' AS has_purpose,
             r.response_signature IS NOT NULL AS response_signed,
             r.created_at, r.expires_at, r.closed_at,
             CASE WHEN r.closed_at IS NOT NULL
                  THEN round(extract(epoch FROM r.closed_at - r.created_at) * 1000)::bigint END AS duration_ms,
             (r.status IN ('awaiting_agent', 'awaiting_owner') AND r.expires_at < now()) AS stuck,
             coalesce(w.wake_attempts, 0)::integer AS wake_attempts,
             w.last_wake_ok
      FROM nexo.requests r
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN j.state = 'done' THEN j.attempt ELSE j.attempt - 1 END) AS wake_attempts,
               (array_agg((j.last_result->>'ok')::boolean ORDER BY j.run_at DESC, j.id DESC)
                  FILTER (WHERE j.last_result IS NOT NULL))[1] AS last_wake_ok
        FROM nexo.wake_jobs j
        WHERE j.request_id = r.id
      ) w ON true
    $v$;
    created := array_append(created, 'v_requests');

    -- Payload real. SOLO nexo_admin_reveal (0003). Se usa únicamente en POST /requests/:id/reveal.
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_request_payloads AS
      SELECT id, args, purpose, result FROM nexo.requests
    $v$;
    created := array_append(created, 'v_request_payloads');
  END IF;

  IF to_regclass('nexo.request_events') IS NOT NULL THEN
    -- detail se reduce a status y code.
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_request_events AS
      SELECT request_id, id, at, kind, detail->>'status' AS status, detail->>'code' AS code
      FROM nexo.request_events
    $v$;
    created := array_append(created, 'v_request_events');
  END IF;

  IF to_regclass('nexo.wake_jobs') IS NOT NULL AND to_regclass('nexo.requests') IS NOT NULL
     AND to_regclass('nexo.agent_connections') IS NOT NULL THEN
    -- Sin cuerpo de respuesta. code es un código corto: el detalle del adaptador solo se
    -- acepta si es un identificador ([a-z_]), nunca texto libre.
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_wake_jobs AS
      SELECT j.id, j.request_id, j.attempt, j.state, j.run_at,
             c.wake_kind AS kind,
             (j.last_result->>'ok')::boolean AS ok,
             CASE WHEN jsonb_typeof(j.last_result->'status') = 'number'
                  THEN (j.last_result->>'status')::numeric::integer END AS http_status,
             CASE
               WHEN j.last_result IS NULL THEN NULL
               WHEN (j.last_result->>'detail') ~ '^[a-z_]{1,40}$' THEN j.last_result->>'detail'
               WHEN (j.last_result->>'ok')::boolean THEN 'ok'
               WHEN coalesce((j.last_result->>'retryable')::boolean, false) THEN 'retryable'
               ELSE 'failed'
             END AS code,
             CASE WHEN jsonb_typeof(j.last_result->'ms') = 'number'
                  THEN (j.last_result->>'ms')::numeric END AS latency_ms,
             r.to_user_id AS user_id,
             r.target_agent_id AS agent_id
      FROM nexo.wake_jobs j
      JOIN nexo.requests r ON r.id = j.request_id
      LEFT JOIN nexo.agent_connections c
        ON c.user_id = r.to_user_id AND c.agent_id = r.target_agent_id
    $v$;
    created := array_append(created, 'v_wake_jobs');
  END IF;

  IF to_regclass('nexo.agent_connections') IS NOT NULL THEN
    -- Solo el host de la URL de aviso. Nunca wake_secret ni la URL completa.
    EXECUTE format($v$
      CREATE OR REPLACE VIEW ops.v_agent_connections AS
      SELECT user_id, agent_id, label, wake_kind,
             lower(substring(
               coalesce(wake_public->>'baseUrl', wake_public->>'url', wake_public->>'callbackUrl')
               FROM %L)) AS wake_host,
             verified_at, last_wake_at, revoked_at, created_at
      FROM nexo.agent_connections
    $v$, host_pattern);
    created := array_append(created, 'v_agent_connections');
  END IF;

  IF to_regclass('nexo.users') IS NOT NULL AND to_regclass('nexo.sharing_rules') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_users AS
      SELECT u.user_id, u.address, u.display_name, u.created_at, s.rules
      FROM nexo.users u
      LEFT JOIN nexo.sharing_rules s ON s.user_id = u.user_id
    $v$;
    created := array_append(created, 'v_users');
  END IF;

  -- ---------- Better Auth de web (public."user", session, oauth*) ----------
  -- Son opcionales: si cambian de forma, se avisa y se sigue con el resto.

  IF to_regclass('public."user"') IS NOT NULL AND to_regclass('public.session') IS NOT NULL THEN
    BEGIN
      -- Sin tokens de sesión.
      EXECUTE $v$
        CREATE OR REPLACE VIEW ops.v_identities AS
        SELECT u.id AS user_id, u.email, u.name, u."createdAt" AS created_at,
               (SELECT count(*) FROM public.session s
                 WHERE s."userId" = u.id AND s."expiresAt" > now()) AS active_sessions
        FROM public."user" u
      $v$;
      created := array_append(created, 'v_identities');
    EXCEPTION WHEN undefined_column OR undefined_table OR datatype_mismatch OR invalid_table_definition THEN
      RAISE WARNING 'ops.v_identities no se creó: %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public."oauthClient"') IS NOT NULL
     AND to_regclass('public."oauthAccessToken"') IS NOT NULL
     AND to_regclass('public."oauthRefreshToken"') IS NOT NULL THEN
    BEGIN
      -- Sin clientSecret ni tokens. Un token activo es uno sin revocar y sin vencer (access o refresh).
      EXECUTE format($v$
        CREATE OR REPLACE VIEW ops.v_oauth_clients AS
        SELECT c."clientId" AS client_id, c.name, c."userId" AS user_id,
               ARRAY(
                 SELECT DISTINCT lower(substring(uri FROM %L))
                 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(c."redirectUris") = 'array' THEN c."redirectUris" ELSE '[]'::jsonb END
                 ) AS uri
                 WHERE substring(uri FROM %L) IS NOT NULL
                 ORDER BY 1
               ) AS redirect_hosts,
               c."createdAt" AS created_at,
               t.last_token_at,
               coalesce(t.active_tokens, 0) AS active_tokens
        FROM public."oauthClient" c
        LEFT JOIN LATERAL (
          SELECT max(created_at) AS last_token_at, count(*) FILTER (WHERE active) AS active_tokens
          FROM (
            SELECT a."createdAt" AS created_at, a.revoked IS NULL AND a."expiresAt" > now() AS active
            FROM public."oauthAccessToken" a WHERE a."clientId" = c."clientId"
            UNION ALL
            SELECT r."createdAt", r.revoked IS NULL AND r."expiresAt" > now()
            FROM public."oauthRefreshToken" r WHERE r."clientId" = c."clientId"
          ) tokens
        ) t ON true
      $v$, host_pattern, host_pattern);
      created := array_append(created, 'v_oauth_clients');

      -- Clientes OAuth que cada persona autorizó (los clientes del registro dinámico no tienen dueño).
      EXECUTE $v$
        CREATE OR REPLACE VIEW ops.v_oauth_grants AS
        SELECT g.user_id, g.client_id, c.name AS client_name,
               max(g.created_at) AS last_token_at,
               count(*) FILTER (WHERE g.active) AS active_tokens
        FROM (
          SELECT a."userId" AS user_id, a."clientId" AS client_id, a."createdAt" AS created_at,
                 a.revoked IS NULL AND a."expiresAt" > now() AS active
          FROM public."oauthAccessToken" a WHERE a."userId" IS NOT NULL
          UNION ALL
          SELECT r."userId", r."clientId", r."createdAt", r.revoked IS NULL AND r."expiresAt" > now()
          FROM public."oauthRefreshToken" r
        ) g
        LEFT JOIN public."oauthClient" c ON c."clientId" = g.client_id
        GROUP BY g.user_id, g.client_id, c.name
      $v$;
      created := array_append(created, 'v_oauth_grants');
    EXCEPTION WHEN undefined_column OR undefined_table OR datatype_mismatch OR invalid_table_definition THEN
      RAISE WARNING 'ops.v_oauth_clients/v_oauth_grants no se crearon: %', SQLERRM;
    END;
  END IF;

  -- ---------- Coordinación (apps/server/sql) ----------

  IF to_regclass('public.people') IS NOT NULL AND to_regclass('public.memberships') IS NOT NULL THEN
    BEGIN
      -- Sin token_hash. can_ask y can_share son los grupos donde la persona tiene ese permiso.
      EXECUTE $v$
        CREATE OR REPLACE VIEW ops.v_coordination_people AS
        SELECT p.id AS person_id,
               coalesce(array_agg(m.group_id ORDER BY m.group_id) FILTER (WHERE m.group_id IS NOT NULL),
                        ARRAY[]::text[]) AS groups,
               coalesce(array_agg(m.group_id ORDER BY m.group_id) FILTER (WHERE m.can_ask),
                        ARRAY[]::text[]) AS can_ask,
               coalesce(array_agg(m.group_id ORDER BY m.group_id) FILTER (WHERE m.can_share),
                        ARRAY[]::text[]) AS can_share
        FROM public.people p
        LEFT JOIN public.memberships m ON m.person_id = p.id
        GROUP BY p.id
      $v$;
      created := array_append(created, 'v_coordination_people');
    EXCEPTION WHEN undefined_column OR undefined_table OR datatype_mismatch OR invalid_table_definition THEN
      RAISE WARNING 'ops.v_coordination_people no se creó: %', SQLERRM;
    END;
  END IF;

  -- Los permisos exactos viven en 0003 (ops.apply_view_grants). Si ya existe, se reaplica
  -- para cubrir las vistas recién creadas.
  IF to_regprocedure('ops.apply_view_grants()') IS NOT NULL THEN
    PERFORM ops.apply_view_grants();
  END IF;

  RETURN created;
END
$fn$;

REVOKE ALL ON FUNCTION ops.refresh_views() FROM PUBLIC;

SELECT ops.refresh_views();
