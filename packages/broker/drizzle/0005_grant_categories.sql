DROP INDEX "sideband"."grants_live_idx";--> statement-breakpoint
ALTER TABLE "sideband"."grants" ADD COLUMN "category" text;--> statement-breakpoint
UPDATE "sideband"."grants" SET "category" = CASE "tool"
	WHEN 'availability' THEN 'availability'
	WHEN 'interest_check' THEN 'interests'
	WHEN 'question' THEN 'general'
END;--> statement-breakpoint
DELETE FROM "sideband"."grants" WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "sideband"."grants" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "grants_live_idx" ON "sideband"."grants" USING btree ("grantor_user_id","grantee_address","category") WHERE "sideband"."grants"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "sideband"."grants" DROP COLUMN "tool";--> statement-breakpoint
ALTER TABLE "sideband"."grants" DROP COLUMN "fields";--> statement-breakpoint
ALTER TABLE "sideband"."grants" DROP COLUMN "friend_default";--> statement-breakpoint
UPDATE "sideband"."requests" SET "args" = jsonb_set("args", '{share}', (
	SELECT coalesce(jsonb_agg("category" ORDER BY "position"), '[]'::jsonb) FROM (VALUES
		(1, 'availability', "args"->'share'->>'availability' <> 'none'),
		(2, 'interests', ("args"->'share'->>'interests')::boolean),
		(3, 'general', ("args"->'share'->>'questions')::boolean)
	) AS "shared"("position", "category", "given") WHERE "given"
)) WHERE "tool" = 'connect' AND jsonb_typeof("args"->'share') = 'object';
