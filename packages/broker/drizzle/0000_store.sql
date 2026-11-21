CREATE SCHEMA IF NOT EXISTS "sideband";
--> statement-breakpoint
CREATE TABLE "sideband"."agent_connections" (
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"label" text NOT NULL,
	"wake_kind" text NOT NULL,
	"wake_public" jsonb NOT NULL,
	"wake_secret" "bytea",
	"verified_at" timestamp with time zone,
	"last_wake_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_connections_user_id_agent_id_pk" PRIMARY KEY("user_id","agent_id"),
	CONSTRAINT "agent_connections_wake_secret_check" CHECK (("sideband"."agent_connections"."wake_kind" = 'none') = ("sideband"."agent_connections"."wake_secret" is null))
);
--> statement-breakpoint
CREATE TABLE "sideband"."request_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sideband"."requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"target_agent_id" text,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"purpose" text,
	"status" text NOT NULL,
	"outcome" text,
	"allowed_fields" text[] NOT NULL,
	"guidance" text NOT NULL,
	"rule" text NOT NULL,
	"decision_reason" text,
	"internal_reason" text,
	"result" jsonb,
	"dropped_fields" text[],
	"answered_by_agent_id" text,
	"escalated" boolean NOT NULL,
	"envelope_signature" text NOT NULL,
	"response_signature" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "requests_status_check" CHECK ("sideband"."requests"."status" in ('awaiting_agent', 'awaiting_owner', 'answered', 'no_data', 'declined', 'denied', 'expired', 'delivery_failed'))
);
--> statement-breakpoint
CREATE TABLE "sideband"."sharing_rules" (
	"user_id" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sideband"."users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"address" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "sideband"."wake_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"request_version" integer NOT NULL,
	"attempt" integer NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"last_result" jsonb,
	CONSTRAINT "wake_jobs_state_check" CHECK ("sideband"."wake_jobs"."state" in ('queued', 'running', 'done'))
);
--> statement-breakpoint
ALTER TABLE "sideband"."agent_connections" ADD CONSTRAINT "agent_connections_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "sideband"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."requests" ADD CONSTRAINT "requests_from_user_id_users_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."requests" ADD CONSTRAINT "requests_to_user_id_users_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."sharing_rules" ADD CONSTRAINT "sharing_rules_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "sideband"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sideband"."wake_jobs" ADD CONSTRAINT "wake_jobs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "sideband"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_events_request_id_id_idx" ON "sideband"."request_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "requests_to_address_status_idx" ON "sideband"."requests" USING btree ("to_address","status");--> statement-breakpoint
CREATE INDEX "requests_from_user_created_at_idx" ON "sideband"."requests" USING btree ("from_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "requests_to_user_created_at_idx" ON "sideband"."requests" USING btree ("to_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "requests_status_expires_at_idx" ON "sideband"."requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "wake_jobs_state_run_at_idx" ON "sideband"."wake_jobs" USING btree ("state","run_at","id");
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "sideband"."request_events" FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "sideband"."reject_request_event_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de solicitudes solo admite inserciones.' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "request_events_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "sideband"."request_events"
FOR EACH STATEMENT EXECUTE FUNCTION "sideband"."reject_request_event_mutation"();
