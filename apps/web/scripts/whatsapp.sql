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
