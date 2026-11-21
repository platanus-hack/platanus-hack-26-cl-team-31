CREATE TABLE "sideband"."grants" (
	"id" text PRIMARY KEY NOT NULL,
	"grantor_user_id" text NOT NULL,
	"grantee_address" text NOT NULL,
	"tool" text NOT NULL,
	"fields" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sideband"."grants" ADD CONSTRAINT "grants_grantor_user_id_users_user_id_fk" FOREIGN KEY ("grantor_user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grants_live_idx" ON "sideband"."grants" USING btree ("grantor_user_id","grantee_address","tool") WHERE "sideband"."grants"."revoked_at" is null;