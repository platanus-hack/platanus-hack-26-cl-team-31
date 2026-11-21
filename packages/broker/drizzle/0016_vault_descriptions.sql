ALTER TABLE "sideband"."vault_categories" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sideband"."users" ADD COLUMN "vault_seeded" boolean DEFAULT false NOT NULL;
