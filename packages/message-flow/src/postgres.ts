import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Telemetry } from "@team-31/telemetry";
import type { MessageReply, TurnState, TurnStore } from "./types.js";

type Row = {
  id: string; parent_id: string | null; delivery_id: string | null; state: TurnState | null; outcome: MessageReply["kind"] | null;
  clarification: Extract<MessageReply, { kind: "clarification" }> | null;
};
type Options = Pick<Telemetry, "emit" | "error">;
const ownerFilter = "user_id = $1 AND binding = $2 AND agent_id = $3";
const live = "expires_at > now()";
const columns = "id, parent_id, delivery_id, state, outcome, clarification";

export function createPostgresTurnStore(connectionString: string, telemetry?: Options) {
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5_000, statement_timeout: 20_000 });
  pool.on("error", error => telemetry?.error("message.turn.connection", error));

  // Each save commits before an external effect. A session lock serializes the binding across
  // replicas, and disappears on disconnect. Never hold a SQL transaction open while calling Claude.
  const run: TurnStore["run"] = async (owner, continuationId, turn) => {
    const identity = [owner.userId, owner.binding, owner.agentId ?? ""];
    const lock = JSON.stringify(identity);
    const client = await pool.connect();
    let locked = false;
    let discard = false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 19))", [lock]);
      locked = true;
      const lookup = async (field: "id" | "parent_id" | "delivery_id", value: string) =>
        (await client.query<Row>(`SELECT ${columns} FROM sideband.message_turns
          WHERE ${ownerFilter} AND ${live} AND ${field} = $4`, [...identity, value])).rows[0];

      let row = owner.deliveryId ? await lookup("delivery_id", owner.deliveryId) : undefined;
      let parent = row?.parent_id ? await lookup("id", row.parent_id) : undefined;
      if (!row && continuationId) {
        parent = await lookup("id", continuationId);
        if (!parent?.state || !parent.outcome) return undefined;
        row = await lookup("parent_id", parent.id);
        if (row && row.delivery_id !== (owner.deliveryId ?? null)) return undefined;
      }
      if (row?.outcome === "clarification" && row.clarification) return row.clarification;
      // Completed reads contain private data. Replaying a delivery must never return a stale
      // vault or directory snapshot, nor reinterpret the old input as a new command.
      if (row?.outcome && row.outcome !== "requests" && row.state?.phase !== "read") return undefined;

      if (!row) {
        const { rows } = await client.query<Row>(
          `INSERT INTO sideband.message_turns (user_id,binding,agent_id,delivery_id,parent_id,id,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,now() + interval '24 hours') RETURNING ${columns}`,
          [...identity, owner.deliveryId ?? null, parent?.id ?? null, randomUUID()]);
        row = rows[0]!;
      }
      const id = row.id;
      let finalState: TurnState | undefined;
      const reply = await turn({
        id, continuationId: id, previous: row.state ?? parent?.state ?? undefined, replay: !!row.outcome,
        async save(state) {
          if (state.phase !== "dispatch") {
            // Decisions and their responses commit together. A crash here resumes the
            // parent prompt (or the last durable dispatch), never a half-finished reply.
            finalState = state;
            return;
          }
          await client.query("UPDATE sideband.message_turns SET state = $2 WHERE id = $1", [id, state]);
          telemetry?.emit("message.turn.saved", { userId: owner.userId, agentId: owner.agentId, attrs: { phase: state.phase } });
        },
      });
      await client.query("UPDATE sideband.message_turns SET outcome = $2, clarification = $3, state = COALESCE($4, state) WHERE id = $1",
        [id, reply.kind, reply.kind === "clarification" ? reply : null, finalState ?? null]);
      if (finalState) telemetry?.emit("message.turn.saved", { userId: owner.userId, agentId: owner.agentId, attrs: { phase: finalState.phase } });
      return reply;
    } finally {
      try {
        if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 19))", [lock]);
      } catch (error) {
        discard = true;
        telemetry?.error("message.turn.unlock", error);
      } finally {
        client.release(discard || !locked);
      }
    }
  };

  // The latest turn supersedes older prompts, including when the latest one is a completed read.
  async function latestContinuation(userId: string, binding: string, phase: "clarify" | "dispatch" = "clarify") {
    const { rows } = await pool.query<{ id: string; phase: string; outcome: string | null }>(
      `SELECT id, state->>'phase' AS phase, outcome FROM sideband.message_turns
       WHERE ${ownerFilter} AND ${live} ORDER BY created_at DESC, id DESC LIMIT 1`, [userId, binding, ""]);
    const latest = rows[0];
    return latest && latest.outcome && latest.phase === phase ? latest.id : undefined;
  }

  // A bounded batch per minute also removes drafts during idle periods.
  const timer = setInterval(() => {
    void pool.query(`DELETE FROM sideband.message_turns WHERE id IN
      (SELECT id FROM sideband.message_turns WHERE expires_at <= now() ORDER BY expires_at LIMIT 1000)`)
      .catch(error => telemetry?.error("message.turn.prune", error));
  }, 60_000);
  timer.unref();

  return { run, latestContinuation, async close() { clearInterval(timer); await pool.end(); } };
}
