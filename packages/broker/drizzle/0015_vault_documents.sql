CREATE TABLE "sideband"."vault_documents" (
  "document_id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "category_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "content" bytea NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_documents_owner_idempotency_idx" ON "sideband"."vault_documents" USING btree ("owner_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "sideband"."vault_documents" ADD CONSTRAINT "vault_documents_category_fk"
  FOREIGN KEY ("owner_id","category_id") REFERENCES "sideband"."vault_categories"("owner_id","category_id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sideband"."vault_documents" ADD CONSTRAINT "vault_documents_size_check"
  CHECK ("size_bytes" >= 0 AND "size_bytes" <= 5242880);
