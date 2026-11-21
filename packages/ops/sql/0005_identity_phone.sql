-- public."user" ganó la columna "phoneNumber" (packages/auth). El admin solo ve si la persona
-- tiene teléfono registrado, nunca el número. Ver docs/admin.md 2.2.
-- Requiere haber corrido antes la migración de auth (pnpm nexo:auth:migrate).
DO $$
BEGIN
  IF to_regclass('public."user"') IS NOT NULL AND to_regclass('public.session') IS NOT NULL THEN
    BEGIN
      EXECUTE $v$
        CREATE OR REPLACE VIEW ops.v_identities AS
        SELECT u.id AS user_id, u.email, u.name, u."createdAt" AS created_at,
               (SELECT count(*) FROM public.session s
                 WHERE s."userId" = u.id AND s."expiresAt" > now()) AS active_sessions,
               u."phoneNumber" IS NOT NULL AS has_phone_number
        FROM public."user" u
      $v$;
    EXCEPTION WHEN undefined_column OR undefined_table OR datatype_mismatch OR invalid_table_definition THEN
      RAISE WARNING 'ops.v_identities no se actualizó: %', SQLERRM;
    END;
  END IF;
END $$;
