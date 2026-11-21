LOCK TABLE sideband.agent_connections IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH ranked AS (
  SELECT user_id, agent_id, row_number() OVER (
    PARTITION BY user_id ORDER BY created_at, agent_id COLLATE "C"
  ) AS position
  FROM sideband.agent_connections WHERE revoked_at IS NULL
)
UPDATE sideband.agent_connections AS a SET revoked_at = CURRENT_TIMESTAMP
FROM ranked AS r
WHERE r.position > 1 AND a.user_id = r.user_id AND a.agent_id = r.agent_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_connections_one_active" ON "sideband"."agent_connections" USING btree ("user_id") WHERE "sideband"."agent_connections"."revoked_at" is null;
