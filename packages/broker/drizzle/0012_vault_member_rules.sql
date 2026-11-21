CREATE TABLE "sideband"."vault_member_rules" (
	"owner_id" text NOT NULL,
	"category_id" text NOT NULL,
	"address" text NOT NULL,
	"allowed" boolean NOT NULL,
	CONSTRAINT "vault_member_rules_owner_id_category_id_address_pk" PRIMARY KEY("owner_id","category_id","address")
);
--> statement-breakpoint
ALTER TABLE "sideband"."vault_member_rules" ADD CONSTRAINT "vault_member_rules_owner_id_category_id_vault_categories_owner_id_category_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "sideband"."vault_categories"("owner_id","category_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_member_rules" ADD CONSTRAINT "vault_member_rules_owner_id_address_friends_user_id_address_fk" FOREIGN KEY ("owner_id","address") REFERENCES "sideband"."friends"("user_id","address") ON DELETE cascade ON UPDATE no action;