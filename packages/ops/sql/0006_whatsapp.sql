-- Called by applyOpsMigrations, including when web created its tables later.
-- Exposes only counts; no phone, code hash, or message ID.
CREATE FUNCTION ops.refresh_whatsapp_view() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $$
BEGIN
  IF to_regclass('whatsapp.pairing') IS NOT NULL AND to_regclass('whatsapp.receipt') IS NOT NULL THEN
    CREATE OR REPLACE VIEW ops.v_whatsapp AS
    SELECT
      (SELECT count(*) FROM public."user" WHERE whatsapp_linked_at IS NOT NULL AND "phoneNumber" IS NOT NULL) AS linked_accounts,
      (SELECT count(*) FROM whatsapp.pairing WHERE expires_at > now()) AS active_pairings,
      (SELECT count(*) FROM whatsapp.receipt WHERE expires_at > now()) AS inbound_receipts;
    PERFORM ops.apply_view_grants();
  END IF;
END $$;

REVOKE ALL ON FUNCTION ops.refresh_whatsapp_view() FROM PUBLIC;
