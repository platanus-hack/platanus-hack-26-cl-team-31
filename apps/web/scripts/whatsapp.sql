ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS whatsapp_linked_at timestamptz;

CREATE SCHEMA IF NOT EXISTS whatsapp;
CREATE TABLE IF NOT EXISTS whatsapp.pairing (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  phone text
);

-- Keep only opaque inbound IDs, never message bodies or WhatsApp replies.
CREATE TABLE IF NOT EXISTS whatsapp.receipt (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_receipt_expiry ON whatsapp.receipt (expires_at);

-- Deployments with a separate web role must provision it before running this migration.
-- In local and single-role deployments the web connection already owns these tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_web_runtime') THEN
    GRANT USAGE ON SCHEMA whatsapp TO nexo_web_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp.pairing TO nexo_web_runtime;
    GRANT SELECT, INSERT, DELETE ON whatsapp.receipt TO nexo_web_runtime;
  END IF;
END $$;
