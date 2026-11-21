CREATE TABLE "sideband"."channels" (
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"wake_kind" text NOT NULL,
	"wake_public" jsonb NOT NULL,
	"wake_secret" "bytea",
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channels_user_id_name_pk" PRIMARY KEY("user_id","name"),
	CONSTRAINT "channels_name_check" CHECK ("sideband"."channels"."name" in ('whatsapp')),
	CONSTRAINT "channels_wake_secret_check" CHECK (("sideband"."channels"."wake_kind" = 'none') = ("sideband"."channels"."wake_secret" is null))
);
--> statement-breakpoint
ALTER TABLE "sideband"."requests" ADD COLUMN "origin_channel" text;--> statement-breakpoint
ALTER TABLE "sideband"."wake_jobs" ADD COLUMN "audience" text DEFAULT 'recipient' NOT NULL;--> statement-breakpoint
ALTER TABLE "sideband"."channels" ADD CONSTRAINT "channels_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."requests" ADD CONSTRAINT "requests_origin_channel_check" CHECK ("sideband"."requests"."origin_channel" in ('whatsapp'));--> statement-breakpoint
ALTER TABLE "sideband"."wake_jobs" ADD CONSTRAINT "wake_jobs_audience_check" CHECK ("sideband"."wake_jobs"."audience" in ('recipient', 'origin'));