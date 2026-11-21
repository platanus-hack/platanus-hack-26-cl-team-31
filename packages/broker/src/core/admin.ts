import { AdminActor, AdminReason } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { AdminPort, BrokerDeps } from "../ports.js";
import type { RequestRow, StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";

export type AdminEventCode = "admin_rewake" | "admin_expire" | "admin_revoke";

// Shared with the core so admin actions reuse the exact transitions of the sweep and the owner.
export type AdminHelpers = {
  closePending(tx: StoreTx, row: RequestRow, outcome: "expired", at: Date, code: AdminEventCode): Promise<boolean>;
  enqueue(tx: StoreTx, row: RequestRow, now: Date, requestVersion: number, attempt: number): Promise<void>;
  // Records a telemetry event that is emitted only if the transaction commits.
  record: RecordEvent;
};

function notFound(): BrokerError {
  return new BrokerError("not_found", "No se encontró el recurso.");
}

function invalidState(): BrokerError {
  return new BrokerError("conflict", "La solicitud no está en un estado válido para esta acción.");
}

function requireAction(actor: AdminActor, reason: string): void {
  if (!AdminActor.safeParse(actor).success) throw new BrokerError("unauthorized", "Se requiere un operador del admin.");
  if (!AdminReason.safeParse(reason).success) {
    throw new BrokerError("invalid_input", "El motivo debe tener entre 10 y 500 caracteres.");
  }
}

// Same effect as OwnerPort.revokeAgent: idempotent and keeps the first revocation time.
export async function revokeConnection(tx: StoreTx, userId: string, agentId: string, at: Date): Promise<void> {
  const connection = await tx.getAgentConnection(userId, agentId, true);
  if (!connection) throw notFound();
  if (!connection.revokedAt) await tx.upsertAgentConnection({ ...connection, revokedAt: at });
}

export function createAdminPort({ store, clock, telemetry }: BrokerDeps, { closePending, enqueue, record }: AdminHelpers): AdminPort {
  return {
    async rewake(actor, requestId, reason) {
      requireAction(actor, reason);
      await store.tx(async (tx) => {
        const row = await tx.getRequest(requestId);
        if (!row) throw notFound();
        const now = clock.now();
        if (row.status !== "awaiting_agent" || row.expiresAt <= now) throw invalidState();
        // Each worker attempt leaves one wake event, so the new job continues the retry count.
        const attempts = (await tx.listEvents([row.id]))
          .filter((event) => event.kind === "wake" && event.code !== "admin_rewake").length;
        // Bump the version so a queued retry of the previous version goes stale: one wake chain at a time.
        if (!await tx.updateRequest(row.id, {}, row.version)) throw invalidState();
        await enqueue(tx, row, now, row.version + 1, attempts + 1);
        await tx.appendEvent({ requestId: row.id, at: now, kind: "wake", code: "admin_rewake" });
        record(tx, "admin.action", {
          requestId: row.id, ...(row.targetAgentId ? { agentId: row.targetAgentId } : {}),
          attrs: { action: "rewake", target: row.id },
        });
      });
    },

    async expire(actor, requestId, reason) {
      requireAction(actor, reason);
      await store.tx(async (tx) => {
        const row = await tx.getRequest(requestId);
        if (!row) throw notFound();
        if (row.status !== "awaiting_agent" && row.status !== "awaiting_owner") throw invalidState();
        // A concurrent sweep, reply or decision bumps the version first and this close loses the race.
        if (!await closePending(tx, row, "expired", clock.now(), "admin_expire")) throw invalidState();
        // closePending records status_changed (by admin, from the code) and closed.
        record(tx, "admin.action", { requestId: row.id, attrs: { action: "expire", target: row.id } });
      });
    },

    async revokeAgent(actor, userId, agentId, reason) {
      requireAction(actor, reason);
      await store.tx((tx) => revokeConnection(tx, userId, agentId, clock.now()));
      // Revocation has no request, so it leaves no request_event (code admin_revoke goes to telemetry).
      telemetry?.emit("admin.action", { userId, agentId, attrs: { action: "admin_revoke", target: `${userId}/${agentId}` } });
    },
  };
}
