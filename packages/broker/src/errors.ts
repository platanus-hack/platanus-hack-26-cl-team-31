import type { ErrorCode } from "@team-31/protocol";

export class BrokerError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "BrokerError";
  }
}
