CREATE TABLE "sideband"."circle_members" (
	"circle_id" text NOT NULL,
	"address" text NOT NULL,
	"joined_at" timestamp with time zone,
	CONSTRAINT "circle_members_circle_id_address_pk" PRIMARY KEY("circle_id","address")
);
--> statement-breakpoint
CREATE TABLE "sideband"."circles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sideband"."circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "sideband"."circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."circles" ADD CONSTRAINT "circles_owner_user_id_users_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "circle_members_address_idx" ON "sideband"."circle_members" USING btree ("address");