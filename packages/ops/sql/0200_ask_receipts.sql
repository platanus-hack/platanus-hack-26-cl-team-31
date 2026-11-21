CREATE FUNCTION ops.refresh_ask_receipts_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.ask_receipts') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_ask_receipts AS
    SELECT request_id, count(*) AS receipt_count FROM sideband.ask_receipts GROUP BY request_id;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_ask_receipts_view() FROM PUBLIC;
