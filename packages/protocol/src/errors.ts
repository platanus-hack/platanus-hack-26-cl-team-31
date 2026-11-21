import { z } from "zod";
import { WakeVerificationReason } from "./wake.js";

export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid_input",
  "conflict",
  "expired",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), reason: WakeVerificationReason.optional() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

const httpStatuses = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  expired: 410,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

export function httpStatusOf(code: ErrorCode) {
  return httpStatuses[code];
}
