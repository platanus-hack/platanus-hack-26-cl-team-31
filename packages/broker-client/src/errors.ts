import type { ErrorCode, WakeVerificationReason } from "@team-31/protocol";

type ErrorDetails = ErrorOptions & {
  errorId?: string;
  stage?: "url" | "signing" | "transport" | "decoding" | "response";
  reason?: WakeVerificationReason;
};

export class BrokerError extends Error {
  readonly errorId?: string;
  readonly stage?: ErrorDetails["stage"];
  readonly reason?: WakeVerificationReason;

  constructor(public readonly code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message, details);
    this.name = "BrokerError";
    this.errorId = details?.errorId;
    this.stage = details?.stage;
    this.reason = details?.reason;
  }
}
