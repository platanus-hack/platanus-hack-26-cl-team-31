CREATE TABLE "sideband"."contact_tags" (
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "contact_tags_user_id_address_pk" PRIMARY KEY("user_id","address")
);
--> statement-breakpoint
CREATE TABLE "sideband"."tag_presets" (
	"user_id" text NOT NULL,
	"tag" text NOT NULL,
	"categories" jsonb NOT NULL,
	CONSTRAINT "tag_presets_user_id_tag_pk" PRIMARY KEY("user_id","tag")
);
--> statement-breakpoint
ALTER TABLE "sideband"."contact_tags" ADD CONSTRAINT "contact_tags_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."tag_presets" ADD CONSTRAINT "tag_presets_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;