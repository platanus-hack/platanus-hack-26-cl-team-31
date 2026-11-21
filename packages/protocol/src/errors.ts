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

/** Un fallo de zod, o cualquier cosa que exponga `issues` con rutas. */
export type IssueSource = { readonly issues?: readonly { readonly path: readonly PropertyKey[] }[] } | undefined;

/** Largo máximo de un motivo `invalid_input`: suficiente para nombrar campos, nunca para un volcado. */
export const invalidInputReasonLimit = 300;

/**
 * Nombra los campos que un esquema rechazó.
 *
 * Solo viajan las RUTAS, nunca los valores ni el texto que genera zod: la ruta describe el
 * payload que el propio llamador acaba de enviar, así que nombrarla no le revela nada ajeno.
 * Úsalo exclusivamente en `invalid_input`. Las demás denegaciones no llevan motivo
 * (docs/security.md, invariante 2).
 */
export function invalidFields(error: IssueSource, limit = 5): string[] {
  const paths = (error?.issues ?? [])
    .map((issue) => issue.path.map((key) => String(key)).join("."))
    .filter((path) => path.length > 0 && path.length <= 60);
  return [...new Set(paths)].slice(0, limit);
}

/** `base`, más los campos que el esquema rechazó cuando supo nombrarlos. */
export function invalidInputMessage(base: string, error: IssueSource): string {
  const fields = invalidFields(error);
  const message = fields.length === 0 ? base : `${base} Revisa: ${fields.join(", ")}.`;
  return message.slice(0, invalidInputReasonLimit);
}
