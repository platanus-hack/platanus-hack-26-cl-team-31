import { randomUUID } from "node:crypto"
import { ZodError, type z } from "zod"
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
  readonly retryAfter?: number

  constructor(code: ErrorCode, message: string, options?: { retryAfter?: number }) {
    super(message)
    this.code = code
    this.retryAfter = options?.retryAfter
  }
}

// Registra un error sin mensajes crudos (pueden traer datos de Postgres o de la red)
// y devuelve su errorId. Mismas reglas que apps/broker/src/log.ts.
// TODO(admin): reemplazar por telemetry.error(operation, error) cuando llegue ADM-01.
export function logFailure(operation: string, error: unknown): string {
  const errorId = randomUUID()
  const frames = error instanceof Error
    ? error.stack?.split("\n").slice(1).flatMap((line) => {
        const frame = /^\s+at .*?\b(apps\/admin\/(?:server|dist)\/[\w/.-]+:\d+:\d+)\)?$/.exec(line)?.[1]
        return frame ? [frame] : []
      })
    : undefined
  console.error("[admin] Error interno", {
    errorId,
    operation,
    type: error instanceof ZodError ? "invalid_schema" : error instanceof Error ? error.name : typeof error,
    issues: error instanceof ZodError ? error.issues.map(({ code }) => code) : undefined,
    frames,
  })
  return errorId
}
