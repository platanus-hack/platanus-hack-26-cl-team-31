CREATE TABLE "sideband"."tags" (
	"user_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"categories" jsonb NOT NULL,
	CONSTRAINT "tags_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "sideband"."tags" ADD CONSTRAINT "tags_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "sideband"."tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "sideband"."users" ADD COLUMN "tags_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "sideband"."tags" ("user_id", "tag_id", "name", "color", "categories")
SELECT u."user_id", d.tag_id, d.name, d.color, coalesce(p."categories", d.categories)
FROM "sideband"."users" u
CROSS JOIN (VALUES
	('friend', 'Amigo', 'emerald', '["availability","interests"]'::jsonb),
	('family', 'Familia', 'amber', '["availability","interests","health","general"]'::jsonb),
	('work', 'Trabajo', 'violet', '["availability"]'::jsonb)
) AS d(tag_id, name, color, categories)
LEFT JOIN "sideband"."tag_presets" p ON p."user_id" = u."user_id" AND p."tag" = d.tag_id;--> statement-breakpoint
UPDATE "sideband"."users" SET "tags_seeded" = true;--> statement-breakpoint
INSERT INTO "sideband"."tags" ("user_id", "tag_id", "name", "color", "categories")
SELECT g."owner_id", g."group_id",
	CASE WHEN EXISTS (SELECT 1 FROM "sideband"."tags" t WHERE t."user_id" = g."owner_id" AND lower(t."name") = lower(g."name"))
		THEN g."name" || ' (' || left(g."group_id", 8) || ')' ELSE g."name" END,
	'slate', '[]'::jsonb
FROM "sideband"."vault_contact_groups" g;--> statement-breakpoint
ALTER TABLE "sideband"."contact_tags" DROP CONSTRAINT "contact_tags_user_id_address_pk";--> statement-breakpoint
ALTER TABLE "sideband"."contact_tags" RENAME COLUMN "tag" TO "tag_id";--> statement-breakpoint
ALTER TABLE "sideband"."contact_tags" ADD CONSTRAINT "contact_tags_user_id_address_tag_id_pk" PRIMARY KEY("user_id","address","tag_id");--> statement-breakpoint
INSERT INTO "sideband"."contact_tags" ("user_id", "address", "tag_id")
SELECT m."owner_id", m."address", m."group_id" FROM "sideband"."vault_contact_group_members" m
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sideband"."contact_tags" ("user_id", "address", "tag_id")
SELECT r."from_user_id", r."to_address", r."sender_group_id" FROM "sideband"."requests" r
WHERE r."tool" = 'connect' AND r."status" IN ('awaiting_owner', 'awaiting_agent') AND r."from_user_id" IS NOT NULL
	AND EXISTS (SELECT 1 FROM "sideband"."tags" t WHERE t."user_id" = r."from_user_id" AND t."tag_id" = r."sender_group_id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "sideband"."contact_tags" ADD CONSTRAINT "contact_tags_user_id_tag_id_tags_user_id_tag_id_fk" FOREIGN KEY ("user_id","tag_id") REFERENCES "sideband"."tags"("user_id","tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" DROP CONSTRAINT "vault_group_valid";--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" DROP CONSTRAINT "vault_permissions_owner_id_category_id_contact_group_pk";--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" RENAME COLUMN "contact_group" TO "tag_id";--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" ADD CONSTRAINT "vault_permissions_owner_id_category_id_tag_id_pk" PRIMARY KEY("owner_id","category_id","tag_id");--> statement-breakpoint
INSERT INTO "sideband"."vault_permissions" ("owner_id", "category_id", "tag_id")
SELECT gp."owner_id", gp."category_id", gp."group_id" FROM "sideband"."vault_contact_group_permissions" gp
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "sideband"."vault_permissions" ADD CONSTRAINT "vault_permissions_owner_id_tag_id_tags_user_id_tag_id_fk" FOREIGN KEY ("owner_id","tag_id") REFERENCES "sideband"."tags"("user_id","tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."requests" DROP COLUMN "sender_group_id" CASCADE;--> statement-breakpoint
DROP TABLE "sideband"."tag_presets" CASCADE;--> statement-breakpoint
DROP TABLE "sideband"."vault_contact_group_members" CASCADE;--> statement-breakpoint
DROP TABLE "sideband"."vault_contact_group_permissions" CASCADE;--> statement-breakpoint
DROP TABLE "sideband"."vault_contact_groups" CASCADE;
