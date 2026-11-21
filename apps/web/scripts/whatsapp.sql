ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS whatsapp_linked_at timestamptz;
-- Opaque id in the URL where the broker notifies this link. Never the user id or the phone.
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS whatsapp_link_id uuid UNIQUE;
-- WhatsApp only accepts free-form messages within 24 hours of the owner's last message.
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS whatsapp_last_inbound_at timestamptz;

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

-- Deliveries that missed the 24-hour window. Only the request id: the reply is read again from the
-- broker when the owner writes next.
CREATE TABLE IF NOT EXISTS whatsapp.pending_delivery (
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

-- Deployments with a separate web role must provision it before running this migration.
-- In local and single-role deployments the web connection already owns these tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_web_runtime') THEN
    GRANT USAGE ON SCHEMA whatsapp TO nexo_web_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp.pairing TO nexo_web_runtime;
    GRANT SELECT, INSERT, DELETE ON whatsapp.receipt TO nexo_web_runtime;
    GRANT SELECT, INSERT, DELETE ON whatsapp.pending_delivery TO nexo_web_runtime;
  END IF;
END $$;
