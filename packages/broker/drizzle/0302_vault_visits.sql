CREATE TABLE "sideband"."vault_visits" (
	"visit_id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"owner_id" text NOT NULL,
	"reader_address" text NOT NULL,
	"category_id" text,
	"kind" text NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vault_visits_kind_check" CHECK ("sideband"."vault_visits"."kind" in ('catalog', 'entries', 'document'))
);
--> statement-breakpoint
ALTER TABLE "sideband"."vault_visits" ADD CONSTRAINT "vault_visits_owner_id_users_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_visits_owner_idx" ON "sideband"."vault_visits" USING btree ("owner_id","seq" DESC NULLS LAST);