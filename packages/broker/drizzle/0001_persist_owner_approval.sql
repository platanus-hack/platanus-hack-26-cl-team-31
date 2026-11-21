ALTER TABLE "sideband"."requests" ADD COLUMN "approved_once" boolean;
--> statement-breakpoint
-- Recover approvals recorded before the Store persisted the flag.
UPDATE "sideband"."requests" AS request
SET "approved_once" = true
WHERE request."rule" = 'Permiso del dueño por única vez'
  AND (request."status" = 'awaiting_agent'
    OR (request."status" = 'answered' AND request."answered_by_agent_id" IS NOT NULL))
  AND EXISTS (
    SELECT 1 FROM "sideband"."request_events" AS event
    WHERE event."request_id" = request."id"
      AND event."kind" = 'permission'
      AND event."detail" ->> 'status' = 'awaiting_agent'
  );
