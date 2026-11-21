-- Count pending group assignments without exposing group IDs or invitation payloads.
CREATE FUNCTION ops.refresh_group_invitations_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sideband' AND table_name = 'requests' AND column_name = 'sender_group_id')
  THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_pending_group_invitations AS
    SELECT from_user_id AS user_id, count(*) AS invitations
    FROM sideband.requests WHERE sender_group_id IS NOT NULL AND tool = 'connect'
      AND status IN ('awaiting_owner', 'awaiting_agent') AND expires_at > now()
    GROUP BY from_user_id;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_group_invitations_view() FROM PUBLIC;
