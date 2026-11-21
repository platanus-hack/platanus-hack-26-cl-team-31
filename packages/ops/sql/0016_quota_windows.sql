CREATE FUNCTION ops.refresh_quota_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.quota_windows') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_quota_windows AS
    SELECT bucket, count(*) AS active_windows FROM sideband.quota_windows
    WHERE reset_at > now() GROUP BY bucket;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_quota_view() FROM PUBLIC;
