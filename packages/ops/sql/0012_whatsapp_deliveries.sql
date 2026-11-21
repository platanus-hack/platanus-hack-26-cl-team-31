-- ops.v_whatsapp gains pending_deliveries: broker notices that missed WhatsApp's 24-hour window and wait
-- for the owner's next message. Only a count: never request ids, phones or message text.
-- applyOpsMigrations calls this function on every run, so it replaces the definition from 0006.
-- The new column goes last so CREATE OR REPLACE VIEW accepts it on existing databases.
CREATE OR REPLACE FUNCTION ops.refresh_whatsapp_view() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $$
BEGIN
  IF to_regclass('whatsapp.pairing') IS NULL OR to_regclass('whatsapp.receipt') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('whatsapp.pending_delivery') IS NULL THEN
    CREATE OR REPLACE VIEW ops.v_whatsapp AS
    SELECT
      (SELECT count(*) FROM public."user" WHERE whatsapp_linked_at IS NOT NULL AND "phoneNumber" IS NOT NULL) AS linked_accounts,
      (SELECT count(*) FROM whatsapp.pairing WHERE expires_at > now()) AS active_pairings,
      (SELECT count(*) FROM whatsapp.receipt WHERE expires_at > now()) AS inbound_receipts;
  ELSE
    CREATE OR REPLACE VIEW ops.v_whatsapp AS
    SELECT
      (SELECT count(*) FROM public."user" WHERE whatsapp_linked_at IS NOT NULL AND "phoneNumber" IS NOT NULL) AS linked_accounts,
      (SELECT count(*) FROM whatsapp.pairing WHERE expires_at > now()) AS active_pairings,
      (SELECT count(*) FROM whatsapp.receipt WHERE expires_at > now()) AS inbound_receipts,
      (SELECT count(*) FROM whatsapp.pending_delivery) AS pending_deliveries;
  END IF;
  PERFORM ops.apply_view_grants();
END $$;

REVOKE ALL ON FUNCTION ops.refresh_whatsapp_view() FROM PUBLIC;
