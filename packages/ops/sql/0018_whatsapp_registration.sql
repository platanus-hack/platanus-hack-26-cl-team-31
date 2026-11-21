-- Older installations may not yet have run the web migration.
DO $$
BEGIN
  IF to_regprocedure('ops.refresh_legacy_whatsapp_view()') IS NULL THEN
    ALTER FUNCTION ops.refresh_whatsapp_view() RENAME TO refresh_legacy_whatsapp_view;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ops.refresh_whatsapp_view() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $$
BEGIN
  IF to_regclass('whatsapp.pending_delivery') IS NULL OR NOT EXISTS (
    SELECT FROM pg_attribute WHERE attrelid = to_regclass('public."user"')
      AND attname = 'whatsapp_channel_registered' AND NOT attisdropped
  ) THEN
    PERFORM ops.refresh_legacy_whatsapp_view();
    RETURN;
  END IF;
  CREATE OR REPLACE VIEW ops.v_whatsapp AS
  SELECT
    count(*) AS linked_accounts,
    (SELECT count(*) FROM whatsapp.pairing WHERE expires_at > now()) AS active_pairings,
    (SELECT count(*) FROM whatsapp.receipt WHERE expires_at > now()) AS inbound_receipts,
    (SELECT count(*) FROM whatsapp.pending_delivery) AS pending_deliveries,
    count(*) FILTER (WHERE NOT whatsapp_channel_registered) AS pending_registrations
  FROM public."user" WHERE whatsapp_linked_at IS NOT NULL AND "phoneNumber" IS NOT NULL;
  PERFORM ops.apply_view_grants();
END $$;

REVOKE ALL ON FUNCTION ops.refresh_whatsapp_view() FROM PUBLIC;
