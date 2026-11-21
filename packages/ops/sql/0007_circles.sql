-- Círculos del broker (sideband.circles y sideband.circle_members). El admin ve cada círculo, quién lo
-- creó y cuántos miembros e invitaciones tiene, sin las direcciones de sus miembros.
-- Requiere haber corrido antes las migraciones del broker (pnpm sideband:broker:migrate).
DO $$
BEGIN
  IF to_regclass('sideband.circles') IS NOT NULL AND to_regclass('sideband.circle_members') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_circles AS
      SELECT c.id AS circle_id, c.name, c.owner_user_id, c.created_at,
             (SELECT count(*) FROM sideband.circle_members m
               WHERE m.circle_id = c.id AND m.joined_at IS NOT NULL) AS members,
             (SELECT count(*) FROM sideband.circle_members m
               WHERE m.circle_id = c.id AND m.joined_at IS NULL) AS invitations
      FROM sideband.circles c
    $v$;
    PERFORM ops.apply_view_grants();
  END IF;
END $$;
