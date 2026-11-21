ALTER TABLE "sideband"."grants" ADD COLUMN "friend_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "sideband"."friends" (
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	CONSTRAINT "friends_user_id_address_pk" PRIMARY KEY("user_id","address")
);
--> statement-breakpoint
ALTER TABLE "sideband"."friends" ADD CONSTRAINT "friends_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;
