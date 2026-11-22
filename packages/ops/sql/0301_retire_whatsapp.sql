-- Keep archived requests and private tables. Remove the admin projections for the retired channel.
DROP VIEW IF EXISTS ops.v_whatsapp;
DROP VIEW IF EXISTS ops.v_channels;
DROP FUNCTION IF EXISTS ops.refresh_legacy_whatsapp_view();

-- Older migrators call this hook on every startup during a rolling upgrade.
CREATE OR REPLACE FUNCTION ops.refresh_whatsapp_view() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;

-- Earlier installations may have an extra phone column in the identity view.
-- refresh_views rebuilds the current projection and restores the admin grants.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns
             WHERE table_schema = 'ops' AND table_name = 'v_identities' AND column_name = 'has_phone_number') THEN
    DROP VIEW ops.v_identities;
    PERFORM ops.refresh_views();
  END IF;
END $$;
