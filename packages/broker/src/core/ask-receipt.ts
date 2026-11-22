import { createHash } from "node:crypto";
import type { AskInput, RequesterView } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { StoreTx } from "../store/store.js";
import { canonicalJson } from "./crypto.js";
import type { RecordEvent } from "./events.js";
import { toRequesterView } from "./views.js";

type AskOrigin = { userId: string; agentId?: string };

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export async function submitOnce(
  tx: StoreTx, origin: AskOrigin, input: AskInput, record: RecordEvent,
  submit: () => Promise<RequesterView | BrokerError>,
): Promise<RequesterView | BrokerError> {
  if (!input.idempotencyKey) return submit();
  const keyHash = digest([origin, input.to, input.idempotencyKey]);
  const inputHash = digest(input);
  const receipt = await tx.lockAskReceipt(keyHash);
  if (receipt) {
    const event = { userId: origin.userId, agentId: origin.agentId, requestId: receipt.requestId };
    if (receipt.inputHash !== inputHash) {
      record(tx, "broker.ask.receipt", { ...event, attrs: { action: "conflict" } });
      return new BrokerError("conflict", "Esta clave de envío ya corresponde a otra solicitud.");
    }
    const row = await tx.getRequest(receipt.requestId, { fromUserId: origin.userId });
    if (!row) throw new BrokerError("internal", "No se pudo recuperar el recibo del envío.");
    record(tx, "broker.ask.receipt", { ...event, attrs: { action: "replayed" } });
    // Recover the original receipt. Reading a later answer uses the status port and its scope.
    const status = receipt.waitingFor === "agent" ? "awaiting_agent"
      : receipt.waitingFor === "owner" ? "awaiting_owner" : row.status;
    return toRequesterView({ ...row, status });
  }

  const result = await submit();
  if (result instanceof BrokerError) return result;
  await tx.insertAskReceipt({
    keyHash, inputHash, requestId: result.requestId, waitingFor: result.final ? null : result.waitingFor,
  });
  record(tx, "broker.ask.receipt", {
    userId: origin.userId, agentId: origin.agentId, requestId: result.requestId, attrs: { action: "created" },
  });
  return result;
}
