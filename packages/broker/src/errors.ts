import type { ErrorCode, WakeVerificationReason } from "@team-31/protocol";

type ErrorDetails = {
  errorId?: string;
  stage?: "url" | "signing" | "transport" | "decoding" | "response";
  reason?: WakeVerificationReason;
};

export class BrokerError extends Error {
  readonly errorId?: string;
  readonly stage?: ErrorDetails["stage"];
  readonly reason?: WakeVerificationReason;

  constructor(public readonly code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "BrokerError";
    this.errorId = details?.errorId;
    this.stage = details?.stage;
    this.reason = details?.reason;
  }
}

export function notFound(): BrokerError {
  return new BrokerError("not_found", "No se encontró el recurso.");
}

export function activeAgentConflict(): BrokerError {
  return new BrokerError("conflict", "Ya tienes un agente conectado. Desconéctalo en Agentes antes de conectar otro.");
}
