// Contrato de la API del admin. Lo comparten la SPA (src/), el servidor HTTP (server/)
// y el MCP de administración (server/mcp). Fuente de verdad: docs/admin.md.
//
// Reglas:
// - Todo lo que sale de aquí ya viene redactado. Nunca hay secretos, tokens, nonces ni
//   texto libre de terceros (pregunta, propósito, respuesta). La única excepción es
//   PayloadReveal, que es solo para humanos con rol operator, exige un motivo y queda auditada.
// - Fechas en ISO 8601 con zona. Ids de ops.events (bigint) viajan como string.
import { FinalOutcome, RequestStatus, ToolName, WakeKind } from "@team-31/protocol"
import { EventKind, Level, Service } from "@team-31/telemetry/types"
import { z } from "zod"

export { EventKind, Level, Service }

const Iso = z.iso.datetime({ offset: true })
const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const Attrs = z.record(z.string(), Scalar)
const QueryBoolean = z.union([z.boolean(), z.stringbool()])

// ---------- Identidad y sesiones ----------

export const AdminRole = z.enum(["viewer", "operator"])
export type AdminRole = z.infer<typeof AdminRole>

export const AdminSession = z.object({
  user: z.object({
    id: z.string(),
    email: z.email(),
    name: z.string().nullable(),
    image: z.url().nullable(),
    role: AdminRole,
  }),
  session: z.object({
    id: z.string(),
    createdAt: Iso,
    expiresAt: Iso,
    // true si la sesión se creó hace menos de ADMIN_FRESH_SECONDS (acciones sensibles).
    fresh: z.boolean(),
  }),
})
export type AdminSession = z.infer<typeof AdminSession>

export const ADMIN_TOKEN_PREFIX = "sba_"

export const AdminTokenScope = z.enum(["admin:read", "admin:sql"])
export type AdminTokenScope = z.infer<typeof AdminTokenScope>

export const AdminToken = z.object({
  id: z.string(),
  name: z.string(),
  // Primeros 12 caracteres del token (sba_ + 8), para reconocerlo. Nunca el token completo.
  prefix: z.string(),
  scopes: z.array(AdminTokenScope),
  createdBy: z.email(),
  createdAt: Iso,
  expiresAt: Iso,
  lastUsedAt: Iso.nullable(),
  revokedAt: Iso.nullable(),
})
export type AdminToken = z.infer<typeof AdminToken>

export const CreateAdminToken = z.object({
  name: z.string().min(3).max(60),
  ttlDays: z.number().int().min(1).max(30).default(7),
  scopes: z.array(AdminTokenScope).min(1).default(["admin:read"]),
})
export const CreatedAdminToken = z.object({
  // Se muestra una sola vez. El servidor guarda solo sha256(token).
  token: z.string().startsWith(ADMIN_TOKEN_PREFIX),
  meta: AdminToken,
})

// ---------- Telemetría ----------

export const TelemetryEvent = z.object({
  id: z.string(),
  at: Iso,
  service: Service,
  kind: EventKind,
  name: z.string(),
  level: Level,
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),
  parentSpanId: z.string().nullable(),
  requestId: z.string().nullable(),
  userId: z.string().nullable(),
  agentId: z.string().nullable(),
  durationMs: z.number().nullable(),
  status: z.string().nullable(),
  errorId: z.string().nullable(),
  attrs: Attrs,
})
export type TelemetryEvent = z.infer<typeof TelemetryEvent>

export const EventFilters = z.object({
  service: Service.optional(),
  kind: EventKind.optional(),
  name: z.string().optional(),
  level: Level.optional(),
  requestId: z.string().optional(),
  userId: z.string().optional(),
  traceId: z.string().optional(),
  // Cursor: devuelve eventos con id mayor (tail) o menor (historial) que este.
  afterId: z.string().optional(),
  beforeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
export type EventFilters = z.infer<typeof EventFilters>

// ---------- Resumen ----------

export const Window = z.enum(["15m", "1h", "24h", "7d"])
export type Window = z.infer<typeof Window>

export const ServiceHealth = z.object({
  service: Service,
  instance: z.string(),
  version: z.string().nullable(),
  lastSeenAt: Iso,
  // up: latido hace < 60 s; stale: < 5 min; down: más.
  state: z.enum(["up", "stale", "down"]),
})
export type ServiceHealth = z.infer<typeof ServiceHealth>

export const Overview = z.object({
  window: Window,
  generatedAt: Iso,
  services: z.array(ServiceHealth),
  requests: z.object({
    total: z.number(),
    open: z.number(),
    // Abiertas con expires_at vencido: el barrido no está corriendo.
    stuck: z.number(),
    byStatus: z.record(RequestStatus, z.number()),
    byTool: z.record(z.string(), z.number()),
    timeToFinalMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  }),
  wakes: z.array(z.object({
    kind: WakeKind,
    ok: z.number(),
    failed: z.number(),
    retried: z.number(),
    p95LatencyMs: z.number().nullable(),
  })),
  errors: z.object({
    total: z.number(),
    top: z.array(z.lazy(() => ErrorGroup)),
  }),
  rateLimited: z.number(),
  awaitingClarifications: z.number().optional(),
  activeQuotaWindows: z.number(),
})
export type Overview = z.infer<typeof Overview>

// ---------- Solicitudes ----------

export const RequestSummary = z.object({
  id: z.string(),
  tool: ToolName,
  fromAddress: z.string(),
  toAddress: z.string(),
  status: RequestStatus,
  outcome: FinalOutcome.nullable(),
  rule: z.string(),
  escalated: z.boolean(),
  targetAgentId: z.string().nullable(),
  answeredByAgentId: z.string().nullable(),
  wakeAttempts: z.number(),
  lastWakeOk: z.boolean().nullable(),
  createdAt: Iso,
  expiresAt: Iso,
  closedAt: Iso.nullable(),
  durationMs: z.number().nullable(),
  stuck: z.boolean(),
})
export type RequestSummary = z.infer<typeof RequestSummary>

export const RequestFilters = z.object({
  status: z.array(RequestStatus).optional(),
  tool: ToolName.optional(),
  // Coincide con from o to.
  address: z.string().optional(),
  // Prefijo de request id.
  q: z.string().optional(),
  stuck: QueryBoolean.optional(),
  since: Iso.optional(),
  until: Iso.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type RequestFilters = z.infer<typeof RequestFilters>

export const TimelineItem = z.object({
  at: Iso,
  source: z.enum(["request_event", "telemetry"]),
  kind: z.string(),
  name: z.string(),
  service: Service.nullable(),
  status: z.string().nullable(),
  level: Level,
  durationMs: z.number().nullable(),
  traceId: z.string().nullable(),
  errorId: z.string().nullable(),
  attrs: Attrs,
})
export type TimelineItem = z.infer<typeof TimelineItem>

export const WakeJobRow = z.object({
  id: z.string(),
  requestId: z.string(),
  attempt: z.number(),
  state: z.enum(["queued", "running", "done"]),
  runAt: Iso,
  kind: WakeKind.nullable(),
  ok: z.boolean().nullable(),
  httpStatus: z.number().nullable(),
  code: z.string().nullable(),
})
export type WakeJobRow = z.infer<typeof WakeJobRow>

export const RequestDetail = z.object({
  idempotentReceipts: z.number().int().nonnegative().optional(),
  summary: RequestSummary,
  allowedFields: z.array(z.string()),
  droppedFields: z.array(z.string()),
  decisionReason: z.string().nullable(),
  // Motivo interno del dueño. El solicitante nunca lo ve; el admin sí.
  internalReason: z.string().nullable(),
  argsKeys: z.array(z.string()),
  resultKeys: z.array(z.string()),
  hasPurpose: z.boolean(),
  responseSigned: z.boolean(),
  timeline: z.array(TimelineItem),
  wakes: z.array(WakeJobRow),
  traceIds: z.array(z.string()),
})
export type RequestDetail = z.infer<typeof RequestDetail>

export const RevealInput = z.object({ reason: z.string().min(10).max(500) })
export const PayloadReveal = z.object({
  requestId: z.string(),
  args: z.unknown(),
  purpose: z.string().nullable(),
  result: z.unknown().nullable(),
  auditId: z.string(),
  revealedAt: Iso,
})
export type PayloadReveal = z.infer<typeof PayloadReveal>

// ---------- Trazas y errores ----------

export const Span = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  service: Service,
  name: z.string(),
  startAt: Iso,
  durationMs: z.number().nullable(),
  status: z.string().nullable(),
  level: Level,
  requestId: z.string().nullable(),
  errorId: z.string().nullable(),
  attrs: Attrs,
})
export const Trace = z.object({ traceId: z.string(), spans: z.array(Span) })
export type Trace = z.infer<typeof Trace>

export const ErrorGroup = z.object({
  service: Service,
  operation: z.string(),
  type: z.string(),
  count: z.number(),
  firstAt: Iso,
  lastAt: Iso,
  sampleErrorId: z.string(),
})
export type ErrorGroup = z.infer<typeof ErrorGroup>

export const ErrorFilters = z.object({
  window: Window.default("24h"),
  service: Service.optional(),
  operation: z.string().optional(),
})

// ---------- Personas y agentes ----------

export const AgentRow = z.object({
  userId: z.string(),
  agentId: z.string(),
  label: z.string(),
  wakeKind: WakeKind,
  // Solo el host del destino de aviso, nunca la URL completa ni el secreto.
  wakeHost: z.string().nullable(),
  verifiedAt: Iso.nullable(),
  lastWakeAt: Iso.nullable(),
  revokedAt: Iso.nullable(),
  createdAt: Iso,
  wakes24h: z.object({ ok: z.number(), failed: z.number() }),
})
export type AgentRow = z.infer<typeof AgentRow>

export const UserSummary = z.object({
  userId: z.string(),
  address: z.string().nullable(),
  displayName: z.string().nullable(),
  createdAt: Iso,
  agents: z.number(),
  sent24h: z.number(),
  received24h: z.number(),
  lastActivityAt: Iso.nullable(),
})
export type UserSummary = z.infer<typeof UserSummary>

export const UserDetail = z.object({
  vault: z.object({ categories: z.number(), entries: z.number(), permissions: z.number(), memberRules: z.number() }).optional(),
  vaultContactGroups: z.object({ groups: z.number(), memberships: z.number(), permissions: z.number() }).optional(),
  summary: UserSummary,
  identity: z.object({
    email: z.string().nullable(),
    activeSessions: z.number(),
    oauthClients: z.array(z.object({
      clientId: z.string(),
      name: z.string().nullable(),
      lastTokenAt: Iso.nullable(),
      activeTokens: z.number(),
    })),
  }),
  // Reglas tal como las guardó el dueño (configuración, no datos de terceros).
  rules: z.unknown().nullable(),
  agents: z.array(AgentRow),
  recentRequests: z.array(RequestSummary),
})
export type UserDetail = z.infer<typeof UserDetail>

export const UserFilters = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const AgentFilters = z.object({
  failing: QueryBoolean.optional(),
  kind: WakeKind.optional(),
})

// ---------- Flujo en vivo ----------
// Página «Flujo» (packages/agent-flow). Solo lo que el admin ya muestra en Personas, Agentes y
// Solicitudes: direcciones, nombres, etiquetas, ids y estados. Nunca contenido.

export const FlowUser = UserSummary.pick({ userId: true, address: true, displayName: true })
export type FlowUser = z.infer<typeof FlowUser>

export const FlowAgent = AgentRow.pick({ userId: true, agentId: true, label: true, wakeKind: true, verifiedAt: true, revokedAt: true, createdAt: true })
export type FlowAgent = z.infer<typeof FlowAgent>

// Quién pregunta y a quién, para atribuir los eventos de una solicitud.
export const FlowRequestRef = RequestSummary.pick({
  id: true, fromAddress: true, toAddress: true, targetAgentId: true, answeredByAgentId: true, status: true, createdAt: true,
})
export type FlowRequestRef = z.infer<typeof FlowRequestRef>

export const FlowSnapshot = z.object({
  generatedAt: Iso,
  // Último id de ops.events al tomar la foto: el stream sigue desde aquí sin huecos.
  cursor: z.string().nullable(),
  users: z.array(FlowUser),
  // Conexiones activas y las revocadas en las últimas 24 h (para nombrar eventos recientes).
  agents: z.array(FlowAgent),
  // Abiertas y cerradas en los últimos 15 min.
  requests: z.array(FlowRequestRef),
  // true si se recortó alguna lista por el límite.
  truncated: z.boolean(),
})
export type FlowSnapshot = z.infer<typeof FlowSnapshot>

export const FlowLiveQuery = z.object({
  // Cursor inicial (FlowSnapshot.cursor). Last-Event-ID, si viene, gana.
  after: z.string().regex(/^\d{1,19}$/).optional(),
})

// Mensajes del SSE de /api/admin/flow/live.
export const FlowReset = z.object({ cursor: z.string().nullable() })

// ---------- Acciones de operador ----------
// Se ejecutan en el broker (AdminPort) para respetar sus invariantes. Nunca escriben la base directo.

export const ActionReason = z.string().min(10).max(500)
export const RewakeInput = z.object({ reason: ActionReason })
export const ExpireInput = z.object({ reason: ActionReason })
export const RevokeAgentInput = z.object({ reason: ActionReason })
export const ActionResult = z.object({ ok: z.literal(true), auditId: z.string() })

// ---------- Auditoría ----------

export const AuditEntry = z.object({
  id: z.string(),
  at: Iso,
  actorType: z.enum(["admin", "token"]),
  actorId: z.string(),
  actorLabel: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
})
export type AuditEntry = z.infer<typeof AuditEntry>

// ---------- SQL de solo lectura (MCP y consola) ----------

export const SqlInput = z.object({
  // Un solo SELECT/WITH sobre vistas ops.v_*. El rol de Postgres hace cumplir el resto.
  sql: z.string().min(1).max(4000),
})
export const SqlResult = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  truncated: z.boolean(),
  durationMs: z.number(),
})
export type SqlResult = z.infer<typeof SqlResult>

// ---------- Tabla de rutas ----------
// role: rol mínimo. fresh: exige sesión fresca. Las rutas /api/admin/* aceptan solo
// sesión de navegador; los tokens sba_ solo sirven en /mcp.

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })
const idParams = z.object({ id: z.string() })
const agentParams = z.object({ userId: z.string(), agentId: z.string() })

export const adminRoutes = {
  session: { method: "GET", path: "/api/admin/session", response: AdminSession, role: "viewer" },
  overview: { method: "GET", path: "/api/admin/overview", query: z.object({ window: Window.default("1h") }), response: Overview, role: "viewer" },
  services: { method: "GET", path: "/api/admin/services", response: z.object({ items: z.array(ServiceHealth) }), role: "viewer" },

  requests: { method: "GET", path: "/api/admin/requests", query: RequestFilters, response: page(RequestSummary), role: "viewer" },
  request: { method: "GET", path: "/api/admin/requests/:id", params: idParams, response: RequestDetail, role: "viewer" },
  revealPayload: { method: "POST", path: "/api/admin/requests/:id/reveal", params: idParams, body: RevealInput, response: PayloadReveal, role: "operator", fresh: true },
  rewake: { method: "POST", path: "/api/admin/requests/:id/rewake", params: idParams, body: RewakeInput, response: ActionResult, role: "operator", fresh: true },
  expire: { method: "POST", path: "/api/admin/requests/:id/expire", params: idParams, body: ExpireInput, response: ActionResult, role: "operator", fresh: true },

  trace: { method: "GET", path: "/api/admin/traces/:id", params: idParams, response: Trace, role: "viewer" },
  events: { method: "GET", path: "/api/admin/events", query: EventFilters, response: z.object({ items: z.array(TelemetryEvent) }), role: "viewer" },
  // SSE: event "telemetry" con un TelemetryEvent por mensaje; id = TelemetryEvent.id; acepta Last-Event-ID.
  live: { method: "GET", path: "/api/admin/live", query: EventFilters.omit({ afterId: true, beforeId: true, limit: true }), contentType: "text/event-stream", response: TelemetryEvent, role: "viewer" },
  // Flujo en vivo. SSE: "telemetry" (TelemetryEvent con attrs recortados a lo que dibuja el grafo,
  // id = TelemetryEvent.id), "request" (FlowRequestRef antes del primer evento de cada solicitud) y
  // "reset" (FlowReset: el hueco desde el cursor es demasiado grande; pedir otra foto).
  flowSnapshot: { method: "GET", path: "/api/admin/flow/snapshot", response: FlowSnapshot, role: "viewer" },
  flowLive: { method: "GET", path: "/api/admin/flow/live", query: FlowLiveQuery, contentType: "text/event-stream", response: TelemetryEvent, role: "viewer" },
  errors: { method: "GET", path: "/api/admin/errors", query: ErrorFilters, response: z.object({ items: z.array(ErrorGroup) }), role: "viewer" },
  error: { method: "GET", path: "/api/admin/errors/:id", params: idParams, response: TelemetryEvent, role: "viewer" },

  users: { method: "GET", path: "/api/admin/users", query: UserFilters, response: page(UserSummary), role: "viewer" },
  user: { method: "GET", path: "/api/admin/users/:id", params: idParams, response: UserDetail, role: "viewer" },
  agents: { method: "GET", path: "/api/admin/agents", query: AgentFilters, response: z.object({ items: z.array(AgentRow) }), role: "viewer" },
  revokeAgent: { method: "POST", path: "/api/admin/agents/:userId/:agentId/revoke", params: agentParams, body: RevokeAgentInput, response: ActionResult, role: "operator", fresh: true },
  wakeQueue: { method: "GET", path: "/api/admin/wakes", query: z.object({ state: z.enum(["queued", "running", "done"]).optional() }), response: z.object({ items: z.array(WakeJobRow) }), role: "viewer" },

  sql: { method: "POST", path: "/api/admin/sql", body: SqlInput, response: SqlResult, role: "operator" },
  audit: { method: "GET", path: "/api/admin/audit", query: z.object({ cursor: z.string().optional() }), response: page(AuditEntry), role: "viewer" },

  tokens: { method: "GET", path: "/api/admin/tokens", response: z.object({ items: z.array(AdminToken) }), role: "operator" },
  createToken: { method: "POST", path: "/api/admin/tokens", body: CreateAdminToken, response: CreatedAdminToken, role: "operator", fresh: true },
  revokeToken: { method: "DELETE", path: "/api/admin/tokens/:id", params: idParams, response: z.object({ ok: z.literal(true) }), role: "operator" },
} as const

export type AdminRouteName = keyof typeof adminRoutes

export const ErrorBody = z.object({
  error: z.object({
    code: z.enum(["unauthorized", "forbidden", "not_fresh", "not_found", "invalid_input", "rate_limited", "upstream", "internal"]),
    message: z.string(),
    errorId: z.string().optional(),
  }),
})
