CREATE TABLE "sideband"."vault_categories" (
	"owner_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "vault_categories_owner_id_category_id_pk" PRIMARY KEY("owner_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "sideband"."vault_entries" (
	"owner_id" text NOT NULL,
	"category_id" text NOT NULL,
	"label" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "vault_entries_owner_id_category_id_label_pk" PRIMARY KEY("owner_id","category_id","label")
);
--> statement-breakpoint
CREATE TABLE "sideband"."vault_permissions" (
	"owner_id" text NOT NULL,
	"category_id" text NOT NULL,
	"contact_group" text NOT NULL,
	CONSTRAINT "vault_permissions_owner_id_category_id_contact_group_pk" PRIMARY KEY("owner_id","category_id","contact_group"),
	CONSTRAINT "vault_group_valid" CHECK ("sideband"."vault_permissions"."contact_group" in ('friend','family','work'))
);
--> statement-breakpoint
ALTER TABLE "sideband"."vault_categories" ADD CONSTRAINT "vault_categories_owner_id_users_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_entries" ADD CONSTRAINT "vault_entries_owner_id_category_id_vault_categories_owner_id_category_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "sideband"."vault_categories"("owner_id","category_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" ADD CONSTRAINT "vault_permissions_owner_id_category_id_vault_categories_owner_id_category_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "sideband"."vault_categories"("owner_id","category_id") ON DELETE cascade ON UPDATE no action;