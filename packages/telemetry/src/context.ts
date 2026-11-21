import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

/** Contexto de correlación que viaja con AsyncLocalStorage durante un request o un span. */
export interface TelemetryContext {
  traceId: string;
  /** Span activo. Los eventos emitidos dentro quedan como sus hijos. */
  spanId: string | null;
  requestId: string | null;
  userId: string | null;
  agentId: string | null;
}

export type ContextFields = Partial<Pick<TelemetryContext, "requestId" | "userId" | "agentId">>;

// Un solo almacén por proceso: así el contexto cruza instancias (p. ej. broker HTTP y worker).
export const storage = new AsyncLocalStorage<TelemetryContext>();

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** Lee un encabezado W3C traceparent. Devuelve null si falta o es inválido. */
export function parseTraceparent(header: string | null | undefined): { traceId: string; parentSpanId: string } | null {
  if (!header) return null;
  const match = TRACEPARENT.exec(header.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, parentSpanId] = match as unknown as [string, string, string];
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return null;
  return { traceId, parentSpanId };
}

export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}
