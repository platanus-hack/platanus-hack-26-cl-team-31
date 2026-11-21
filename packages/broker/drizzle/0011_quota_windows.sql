CREATE TABLE "sideband"."quota_windows" (
	"user_id" text NOT NULL,
	"bucket" text NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	CONSTRAINT "quota_windows_user_id_bucket_pk" PRIMARY KEY("user_id","bucket")
);
--> statement-breakpoint
CREATE INDEX "quota_expiry_idx" ON "sideband"."quota_windows" USING btree ("reset_at");