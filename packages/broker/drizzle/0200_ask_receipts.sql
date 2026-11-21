CREATE TABLE "sideband"."ask_receipts" (
  "key_hash" text PRIMARY KEY NOT NULL,
  "input_hash" text NOT NULL,
  "request_id" text NOT NULL,
  "waiting_for" text,
  CONSTRAINT "ask_receipts_request_id_requests_id_fk" FOREIGN KEY ("request_id")
    REFERENCES "sideband"."requests" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "ask_receipts_request_idx" ON "sideband"."ask_receipts" ("request_id");
