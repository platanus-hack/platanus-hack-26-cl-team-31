import { BrokerError } from "@team-31/broker-client";
import { getTelemetry } from "@/lib/telemetry";

export type Feedback = { error?: string; message?: string; errorId?: string };

export function actionError(operation: string, error: unknown, fallback: string): Feedback {
  if (!(error instanceof BrokerError) || error.code === "internal") {
    const localId = getTelemetry().error(`action ${operation}`, error);
    return { error: fallback, errorId: error instanceof BrokerError ? error.errorId ?? localId : localId };
  }
  const messages: Partial<Record<BrokerError["code"], string>> = {
    not_found: "El elemento ya no está disponible.",
    expired: "La solicitud venció.",
    conflict: "La solicitud ya cambió. Actualiza la página.",
    rate_limited: "Espera un momento antes de intentarlo de nuevo.",
  };
  return { error: messages[error.code] ?? fallback, ...(error.errorId && { errorId: error.errorId }) };
}
