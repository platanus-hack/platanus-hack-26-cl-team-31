-- The vault predicate now also decides who may ask about a category. This keeps what every
-- contact can read today and makes the right to ask equal to it.
INSERT INTO "sideband"."vault_categories" ("owner_id", "category_id", "name", "description")
SELECT u."user_id", d.id, d.name, d.description
FROM "sideband"."users" u
CROSS JOIN (VALUES
	('availability', 'Disponibilidad horaria', 'Tus horarios y cuándo estás libre.'),
	('interests', 'Intereses', 'Lo que te gusta y los temas que te interesan.'),
	('health', 'Salud', 'Alergias, tratamientos y contactos médicos.'),
	('general', 'Preguntas abiertas', 'Lo que no entra en otra categoría.')
) AS d(id, name, description)
WHERE NOT u."vault_seeded"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "sideband"."users" SET "vault_seeded" = true WHERE NOT "vault_seeded";--> statement-breakpoint
-- An individual decision stays where the grants and the tag's categories disagree: a grant the
-- tags do not explain, or a tag category the holder turned off by hand for that contact.
INSERT INTO "sideband"."vault_member_rules" ("owner_id", "category_id", "address", "allowed")
SELECT s."owner_id", s."category_id", s."address", s.granted
FROM (
	SELECT c."owner_id", c."category_id", f."address",
		EXISTS (SELECT 1 FROM "sideband"."grants" g
			WHERE g."grantor_user_id" = c."owner_id" AND g."grantee_address" = f."address"
				AND g."category" = c."category_id" AND g."revoked_at" IS NULL) AS granted,
		c."visibility" = 'public' OR EXISTS (SELECT 1 FROM "sideband"."vault_permissions" p
			JOIN "sideband"."contact_tags" t ON t."user_id" = p."owner_id" AND t."tag_id" = p."tag_id"
			WHERE p."owner_id" = c."owner_id" AND p."category_id" = c."category_id" AND t."address" = f."address") AS open,
		EXISTS (SELECT 1 FROM "sideband"."tags" tg
			JOIN "sideband"."contact_tags" t ON t."user_id" = tg."user_id" AND t."tag_id" = tg."tag_id"
			WHERE tg."user_id" = c."owner_id" AND t."address" = f."address"
				AND tg."categories" @> to_jsonb(c."category_id")) AS tagged
	FROM "sideband"."vault_categories" c
	JOIN "sideband"."friends" f ON f."user_id" = c."owner_id"
	WHERE c."category_id" IN ('availability', 'interests', 'health', 'general')
) s
WHERE NOT s.open AND s.granted <> s.tagged
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The categories of a tag become the default vault categories it opens.
INSERT INTO "sideband"."vault_permissions" ("owner_id", "category_id", "tag_id")
SELECT c."owner_id", c."category_id", tg."tag_id"
FROM "sideband"."tags" tg
JOIN "sideband"."vault_categories" c ON c."owner_id" = tg."user_id" AND tg."categories" @> to_jsonb(c."category_id")
WHERE c."category_id" IN ('availability', 'interests', 'health', 'general')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The vault now carries what these grants said. A grant to someone who is not a contact stays.
UPDATE "sideband"."grants" g SET "revoked_at" = now()
WHERE g."revoked_at" IS NULL AND EXISTS (SELECT 1 FROM "sideband"."friends" f
	WHERE f."user_id" = g."grantor_user_id" AND f."address" = g."grantee_address");
