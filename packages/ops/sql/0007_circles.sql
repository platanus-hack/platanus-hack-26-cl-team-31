-- Círculos del broker (nexo.circles y nexo.circle_members). El admin ve cada círculo, quién lo
-- creó y cuántos miembros e invitaciones tiene, sin las direcciones de sus miembros.
-- Requiere haber corrido antes las migraciones del broker (pnpm nexo:broker:migrate).
DO $$
BEGIN
  IF to_regclass('nexo.circles') IS NOT NULL AND to_regclass('nexo.circle_members') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_circles AS
      SELECT c.id AS circle_id, c.name, c.owner_user_id, c.created_at,
             (SELECT count(*) FROM nexo.circle_members m
               WHERE m.circle_id = c.id AND m.joined_at IS NOT NULL) AS members,
             (SELECT count(*) FROM nexo.circle_members m
               WHERE m.circle_id = c.id AND m.joined_at IS NULL) AS invitations
      FROM nexo.circles c
    $v$;
    PERFORM ops.apply_view_grants();
  END IF;
END $$;
