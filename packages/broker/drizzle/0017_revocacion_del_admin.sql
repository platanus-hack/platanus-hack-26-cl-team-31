ALTER TABLE "sideband"."agent_connections" DROP CONSTRAINT "agent_connections_wake_secret_check";--> statement-breakpoint
ALTER TABLE "sideband"."channels" DROP CONSTRAINT "channels_wake_secret_check";--> statement-breakpoint
ALTER TABLE "sideband"."agent_connections" ADD COLUMN "revoked_by" text;--> statement-breakpoint
-- Antes de esta columna la única revocación que existía era la del titular, y es reversible:
-- las filas ya revocadas lo dicen en voz alta en vez de quedar en null. Marcarlas como del admin
-- dejaría sin vuelta a identidades que nunca pasaron por un operador.
UPDATE "sideband"."agent_connections" SET "revoked_by" = 'owner' WHERE "revoked_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sideband"."agent_connections" ADD CONSTRAINT "agent_connections_revoked_by_check" CHECK ("sideband"."agent_connections"."revoked_by" is null or "sideband"."agent_connections"."revoked_by" in ('owner', 'admin'));--> statement-breakpoint
ALTER TABLE "sideband"."agent_connections" ADD CONSTRAINT "agent_connections_wake_secret_check" CHECK (("sideband"."agent_connections"."wake_kind" in ('none', 'polling')) = ("sideband"."agent_connections"."wake_secret" is null));--> statement-breakpoint
ALTER TABLE "sideband"."channels" ADD CONSTRAINT "channels_wake_secret_check" CHECK (("sideband"."channels"."wake_kind" in ('none', 'polling')) = ("sideband"."channels"."wake_secret" is null));