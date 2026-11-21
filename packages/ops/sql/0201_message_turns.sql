CREATE FUNCTION ops.refresh_message_turns_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.message_turns') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_message_turns AS
    SELECT user_id, nullif(agent_id, '') AS agent_id, created_at, expires_at,
           state->>'phase' AS phase, outcome
    FROM sideband.message_turns t WHERE expires_at > now()
      AND NOT EXISTS (SELECT 1 FROM sideband.message_turns child WHERE child.parent_id = t.id);
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_message_turns_view() FROM PUBLIC;
