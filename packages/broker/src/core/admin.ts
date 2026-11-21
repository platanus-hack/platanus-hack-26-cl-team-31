import { AdminActor, AdminReason } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { AdminPort, BrokerDeps } from "../ports.js";
import type { RequestRow, StoreTx } from "../store/store.js";

export type AdminEventCode = "admin_rewake" | "admin_expire" | "admin_revoke";

// Shared with the core so admin actions reuse the exact transitions of the sweep and the owner.
export type AdminHelpers = {
  closePending(tx: StoreTx, row: RequestRow, outcome: "expired", at: Date, code: AdminEventCode): Promise<boolean>;
  enqueue(tx: StoreTx, row: RequestRow, now: Date, requestVersion: number, attempt: number): Promise<void>;
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

export function createAdminPort({ store, clock }: BrokerDeps, { closePending, enqueue }: AdminHelpers): AdminPort {
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
        // TODO(admin): admin.action { action: "rewake", target: requestId } con requestId y agentId (row.targetAgentId)
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
        // TODO(admin): broker.request.status_changed { from: row.status, to: "expired", by: "admin" }
        // TODO(admin): broker.request.closed { outcome: "expired", escalated: row.escalated }
        // TODO(admin): admin.action { action: "expire", target: requestId }
      });
    },

    async revokeAgent(actor, userId, agentId, reason) {
      requireAction(actor, reason);
      await store.tx((tx) => revokeConnection(tx, userId, agentId, clock.now()));
      // Revocation has no request, so it leaves no request_event (code admin_revoke goes to telemetry).
      // TODO(admin): admin.action { action: "admin_revoke", target: `${userId}/${agentId}` } con userId y agentId
    },
  };
}
