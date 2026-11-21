-- Membresía del usuario de migración en los roles del admin (docs/admin.md#producción).
--
-- En Postgres 16+ quien crea un rol con CREATEROLE recibe solo ADMIN OPTION, sin SET: no puede
-- hacer SET ROLE sideband_admin_ro. En local no se nota porque el usuario es superusuario, pero en
-- Postgres administrado (Render) el usuario de la base no lo es. Aquí se otorga la membresía
-- WITH SET TRUE, INHERIT FALSE: puede asumir el rol de forma explícita, pero no hereda nada.
-- Si no se puede, el admin corre en modo degradado (sin SET ROLE y con sql() deshabilitado).

-- Versión robusta de apply_view_grants: no falla si los roles no existen.
CREATE OR REPLACE FUNCTION ops.apply_view_grants() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $fn$
DECLARE
  view_name text;
BEGIN
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('sideband_telemetry_writer', 'sideband_admin_ro', 'sideband_admin_reveal')) < 3 THEN
    RETURN;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM sideband_telemetry_writer, sideband_admin_ro, sideband_admin_reveal;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM sideband_telemetry_writer, sideband_admin_ro, sideband_admin_reveal;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops FROM sideband_telemetry_writer, sideband_admin_ro, sideband_admin_reveal;

  GRANT USAGE ON SCHEMA ops TO sideband_telemetry_writer, sideband_admin_ro, sideband_admin_reveal;

  GRANT INSERT ON ops.events TO sideband_telemetry_writer;
  GRANT USAGE ON SEQUENCE ops.events_id_seq TO sideband_telemetry_writer;

  FOR view_name IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'ops'::regnamespace AND c.relkind = 'v' AND c.relname LIKE 'v\_%'
  LOOP
    IF view_name = 'v_request_payloads' THEN
      EXECUTE format('GRANT SELECT ON ops.%I TO sideband_admin_reveal', view_name);
    ELSE
      EXECUTE format('GRANT SELECT ON ops.%I TO sideband_admin_ro', view_name);
    END IF;
  END LOOP;

  IF to_regclass('admin.audit') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA admin TO sideband_admin_ro;
    GRANT SELECT ON admin.audit TO sideband_admin_ro;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION ops.apply_view_grants() FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['sideband_admin_ro', 'sideband_admin_reveal'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND NOT pg_has_role(current_user, role_name, 'SET') THEN
      BEGIN
        EXECUTE format('GRANT %I TO %I WITH SET TRUE, INHERIT FALSE', role_name, current_user);
      EXCEPTION WHEN insufficient_privilege OR invalid_grant_operation THEN
        RAISE WARNING 'ops: % no puede asumir %; el admin correrá en modo degradado', current_user, role_name;
      END;
    END IF;
  END LOOP;
END
$$;
