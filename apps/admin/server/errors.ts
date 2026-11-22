import type { z } from "zod"
import type { ErrorBody } from "../shared/contract.js"

export type ErrorCode = z.infer<typeof ErrorBody>["error"]["code"]

export const statusOf = {
  unauthorized: 401,
  forbidden: 403,
  not_fresh: 403,
  not_found: 404,
  invalid_input: 400,
  rate_limited: 429,
  upstream: 502,
  internal: 500,
} as const satisfies Record<ErrorCode, number>

// Error con un código del contrato (ErrorBody). Su mensaje se muestra al cliente.
export class AdminHttpError extends Error {
  readonly code: ErrorCode
  readonly errorId?: string
  readonly retryAfter?: number

  constructor(code: ErrorCode, message: string, options?: ErrorOptions & { retryAfter?: number; errorId?: string }) {
    super(message, options)
    this.code = code
    this.errorId = options?.errorId
    this.retryAfter = options?.retryAfter
  }
}
