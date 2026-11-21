CREATE TABLE "sideband"."vault_contact_group_members" (
	"owner_id" text NOT NULL,
	"group_id" text NOT NULL,
	"address" text NOT NULL,
	CONSTRAINT "vault_contact_group_members_owner_id_group_id_address_pk" PRIMARY KEY("owner_id","group_id","address")
);
--> statement-breakpoint
CREATE TABLE "sideband"."vault_contact_group_permissions" (
	"owner_id" text NOT NULL,
	"category_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "vault_contact_group_permissions_owner_id_category_id_group_id_pk" PRIMARY KEY("owner_id","category_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "sideband"."vault_contact_groups" (
	"owner_id" text NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "vault_contact_groups_owner_id_group_id_pk" PRIMARY KEY("owner_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "sideband"."vault_contact_group_members" ADD CONSTRAINT "vault_contact_group_members_owner_id_group_id_vault_contact_groups_owner_id_group_id_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "sideband"."vault_contact_groups"("owner_id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_contact_group_members" ADD CONSTRAINT "vault_contact_group_members_owner_id_address_friends_user_id_address_fk" FOREIGN KEY ("owner_id","address") REFERENCES "sideband"."friends"("user_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_contact_group_permissions" ADD CONSTRAINT "vault_contact_group_permissions_owner_id_category_id_vault_categories_owner_id_category_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "sideband"."vault_categories"("owner_id","category_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_contact_group_permissions" ADD CONSTRAINT "vault_contact_group_permissions_owner_id_group_id_vault_contact_groups_owner_id_group_id_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "sideband"."vault_contact_groups"("owner_id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_contact_groups" ADD CONSTRAINT "vault_contact_groups_owner_id_users_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_contact_group_name" ON "sideband"."vault_contact_groups" USING btree ("owner_id",lower("name"));