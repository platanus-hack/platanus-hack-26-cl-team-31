-- Canales del broker (sideband.channels): dónde avisar al titular cuando cambia una solicitud que
-- escribió desde un canal como WhatsApp. Solo el host de la URL de aviso, igual que
-- ops.v_agent_connections. Nunca wake_secret ni la URL completa.
-- Requiere haber corrido antes las migraciones del broker (pnpm sideband:broker:migrate).
DO $$
DECLARE
  host_pattern constant text := '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]+\]|[^/:?#]+)';
BEGIN
  IF to_regclass('sideband.channels') IS NOT NULL THEN
    EXECUTE format($v$
      CREATE OR REPLACE VIEW ops.v_channels AS
      SELECT user_id, name, wake_kind,
             lower(substring(
               coalesce(wake_public->>'baseUrl', wake_public->>'url', wake_public->>'callbackUrl')
               FROM %L)) AS wake_host,
             created_at
      FROM sideband.channels
    $v$, host_pattern);
    PERFORM ops.apply_view_grants();
  END IF;
END $$;
