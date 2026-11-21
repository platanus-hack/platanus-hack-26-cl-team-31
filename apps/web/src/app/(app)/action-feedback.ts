import { BrokerError } from "@team-31/broker/client";
import { getTelemetry } from "@/lib/telemetry";

export type Feedback = { error?: string; message?: string; errorId?: string };

// Domain errors become a message; anything else is recorded (without its message) before the fallback.
export function actionError(operation: string, error: unknown, fallback: string) {
  if (!(error instanceof BrokerError) || error.code === "internal") {
    getTelemetry().error(`action ${operation}`, error);
    return fallback;
  }
  switch (error.code) {
    case "not_found": return "El elemento ya no está disponible.";
    case "expired": return "La solicitud venció.";
    case "conflict": return "La solicitud ya cambió. Actualiza la página.";
    case "rate_limited": return "Espera un momento antes de intentarlo de nuevo.";
    default: return fallback;
  }
}
