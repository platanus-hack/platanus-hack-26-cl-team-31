CREATE TABLE "sideband"."message_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"binding" text NOT NULL,
	"agent_id" text NOT NULL,
	"delivery_id" text,
	"parent_id" text,
	"state" jsonb,
	"outcome" text,
	"clarification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_turns_parent_id_unique" UNIQUE("parent_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "message_turn_delivery_idx" ON "sideband"."message_turns" USING btree ("user_id","binding","agent_id","delivery_id");--> statement-breakpoint
CREATE INDEX "message_turn_binding_idx" ON "sideband"."message_turns" USING btree ("user_id","binding","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "message_turn_expiry_idx" ON "sideband"."message_turns" USING btree ("expires_at");