// Utilidades de prueba del servidor admin (no se importan desde el código de producción).
import type { AdminQueries } from "../shared/queries.js"
import type { TelemetryEvent } from "../shared/contract.js"

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

const at = "2026-01-01T00:00:00.000Z"

export const telemetryEvent = (id: string): TelemetryEvent => ({
  id,
  at,
  service: "broker",
  kind: "lifecycle",
  name: "broker.request.created",
  level: "info",
  traceId: null,
  spanId: null,
  parentSpanId: null,
  requestId: "req_1",
  userId: null,
  agentId: null,
  durationMs: null,
  status: null,
  errorId: null,
  attrs: { tool: "availability" },
})

// AdminQueries falso: datos mínimos que pasan los esquemas del contrato.
export function fakeQueries(overrides: Partial<AdminQueries> = {}): AdminQueries {
  return {
    overview: async (window) => ({
      window,
      generatedAt: at,
      services: [],
      requests: { total: 0, open: 0, stuck: 0, byStatus: {}, byTool: {}, timeToFinalMs: { p50: null, p95: null } },
      wakes: [],
      errors: { total: 0, top: [] },
      rateLimited: 0,
    }),
    services: async () => [{ service: "broker", instance: "host:1", version: "1.0.0", lastSeenAt: at, state: "up" }],
    requests: async () => ({ items: [], nextCursor: null }),
    request: async () => null,
    trace: async () => null,
    events: async () => [],
    errors: async () => [],
    error: async () => null,
    users: async () => ({ items: [], nextCursor: null }),
    user: async () => null,
    agents: async () => [],
    wakeQueue: async () => [],
    audit: async () => ({ items: [], nextCursor: null }),
    sql: async () => ({ columns: ["one"], rows: [[1]], truncated: false, durationMs: 1 }),
    ...overrides,
  }
}
