-- Roles de Postgres del admin y la telemetría (docs/admin.md#22-vistas-adm-02). Todos NOLOGIN:
-- en producción cada usuario de conexión es miembro de uno de ellos (ADM-08).
--
-- | Rol                   | Permisos                                                              |
-- | nexo_telemetry_writer | INSERT en ops.events y uso de su secuencia.                           |
-- | nexo_admin_ro         | USAGE en ops y SELECT en todas las ops.v_* excepto v_request_payloads. |
-- | nexo_admin_reveal     | SELECT en ops.v_request_payloads.                                     |
--
-- Además, si existe la bitácora del servidor admin (admin.audit, ADM-04), nexo_admin_ro recibe
-- USAGE en el esquema admin y SELECT solo en admin.audit (AdminQueries.audit). ADM-04 otorga lo
-- mismo al crear la tabla si el rol ya existe: cualquiera que corra después deja el permiso.
--
-- Los roles son globales del clúster: la creación tolera carreras con otras bases.

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['nexo_telemetry_writer', 'nexo_admin_ro', 'nexo_admin_reveal'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
      EXCEPTION
        WHEN duplicate_object OR unique_violation THEN
          NULL;
        -- Postgres administrado sin CREATEROLE: el admin queda en modo degradado (docs/admin.md).
        WHEN insufficient_privilege THEN
          RAISE WARNING 'ops: % no puede crear el rol %; el admin correrá en modo degradado', current_user, role_name;
      END;
    END IF;
  END LOOP;
END
$$;

-- Permisos exactos. Primero quita todo lo que esos roles tengan en ops y luego otorga solo lo
-- de la tabla. ops.refresh_views() la vuelve a llamar cada vez que crea vistas nuevas.
CREATE OR REPLACE FUNCTION ops.apply_view_grants() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $fn$
DECLARE
  view_name text;
BEGIN
  -- Sin los roles (modo degradado) no hay permisos que aplicar.
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('nexo_telemetry_writer', 'nexo_admin_ro', 'nexo_admin_reveal')) < 3 THEN
    RETURN;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM nexo_telemetry_writer, nexo_admin_ro, nexo_admin_reveal;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM nexo_telemetry_writer, nexo_admin_ro, nexo_admin_reveal;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops FROM nexo_telemetry_writer, nexo_admin_ro, nexo_admin_reveal;

  GRANT USAGE ON SCHEMA ops TO nexo_telemetry_writer, nexo_admin_ro, nexo_admin_reveal;

  GRANT INSERT ON ops.events TO nexo_telemetry_writer;
  GRANT USAGE ON SEQUENCE ops.events_id_seq TO nexo_telemetry_writer;

  FOR view_name IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'ops'::regnamespace AND c.relkind = 'v' AND c.relname LIKE 'v\_%'
  LOOP
    IF view_name = 'v_request_payloads' THEN
      EXECUTE format('GRANT SELECT ON ops.%I TO nexo_admin_reveal', view_name);
    ELSE
      EXECUTE format('GRANT SELECT ON ops.%I TO nexo_admin_ro', view_name);
    END IF;
  END LOOP;

  IF to_regclass('admin.audit') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA admin TO nexo_admin_ro;
    GRANT SELECT ON admin.audit TO nexo_admin_ro;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION ops.apply_view_grants() FROM PUBLIC;

SELECT ops.apply_view_grants();
