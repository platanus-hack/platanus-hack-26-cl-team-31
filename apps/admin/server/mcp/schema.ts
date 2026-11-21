// Contenido del recurso admin://schema: vistas ops.v_* con sus columnas y el catálogo de
// eventos de telemetría. Las columnas salen de information_schema a través de
// AdminQueries.sql (que corre con el rol nexo_admin_ro, así que solo ve lo que el rol puede
// leer). Si esa consulta falla, se usa la lista estática de docs/admin.md (sección 2.2).
import type { AdminQueries } from "../../shared/queries.js"

export type SchemaView = { name: string; columns: { name: string; type: string | null }[] }
export type CatalogEvent = { name: string; kind: string; attrs: string[] }
export type AdminSchema = {
  source: "information_schema" | "static"
  views: SchemaView[]
  events: CatalogEvent[]
  notes: string[]
}

export const SCHEMA_URI = "admin://schema"

export const COLUMNS_SQL =
  "select table_name, column_name, data_type from information_schema.columns " +
  "where table_schema='ops' and table_name like 'v\\_%' order by 1, ordinal_position"

// Vista que solo puede leer el rol nexo_admin_reveal (humanos, con motivo y auditoría).
// Nunca se anuncia a los agentes.
const HIDDEN_VIEWS = new Set(["v_request_payloads"])

const eventColumns = [
  "id", "at", "service", "instance", "kind", "name", "level", "trace_id", "span_id",
  "parent_span_id", "request_id", "user_id", "agent_id", "duration_ms", "status", "error_id", "attrs",
]

// Copia de docs/admin.md 2.2. Se usa solo si information_schema no responde.
const STATIC_VIEWS: Record<string, string[]> = {
  v_requests: [
    "id", "tool", "from_address", "to_address", "from_user_id", "to_user_id", "status", "outcome", "rule",
    "escalated", "target_agent_id", "answered_by_agent_id", "allowed_fields", "dropped_fields",
    "decision_reason", "internal_reason", "args_keys", "result_keys", "has_purpose", "response_signed",
    "created_at", "expires_at", "closed_at", "duration_ms", "stuck", "wake_attempts", "last_wake_ok",
  ],
  v_request_events: ["request_id", "id", "at", "kind", "status", "code"],
  v_wake_jobs: ["id", "request_id", "attempt", "state", "run_at", "kind", "ok", "http_status", "code"],
  v_agent_connections: [
    "user_id", "agent_id", "label", "wake_kind", "wake_host", "verified_at", "last_wake_at", "revoked_at", "created_at",
  ],
  v_users: ["user_id", "address", "display_name", "created_at", "rules"],
  v_identities: ["user_id", "email", "name", "created_at", "active_sessions"],
  v_oauth_clients: ["client_id", "name", "user_id", "redirect_hosts", "created_at", "last_token_at", "active_tokens"],
  v_events: eventColumns,
  v_service_health: ["service", "instance", "version", "last_seen_at", "state"],
  v_errors: ["service", "operation", "type", "count", "first_at", "last_at", "sample_error_id"],
  v_coordination_people: ["person_id", "groups", "can_ask", "can_share"],
}

const group = (names: string[], kind: string, attrs: string[]): CatalogEvent[] =>
  names.map((name) => ({ name, kind, attrs }))

// Copia del catálogo de packages/telemetry/src/catalog.ts (docs/admin.md sección 3).
// TODO(admin): reemplazar por describeCatalog() de @team-31/telemetry cuando apps/admin
// dependa del paquete (ADM-04/ADM-08 lo agregan a package.json).
export const EVENT_CATALOG: CatalogEvent[] = [
  ...group(["service.started", "service.heartbeat", "service.stopping"], "lifecycle", ["version", "dropped"]),
  ...group(["http.request"], "http", ["method", "route", "status", "bucket"]),
  ...group(["http.rate_limited"], "http", ["route", "bucket"]),
  ...group(["auth.token.verified", "auth.token.rejected"], "auth", ["issuer", "reason"]),
  ...group(["auth.service_jwt.rejected"], "auth", ["expectedIss", "reason"]),
  ...group(["auth.oauth.consent"], "auth", ["clientId", "granted"]),
  ...group(["mcp.tool.call"], "tool", ["tool", "outcome"]),
  ...group(["broker.policy.evaluated"], "policy", ["tool", "decision", "rule"]),
  ...group(["broker.request.created"], "lifecycle", ["tool", "rule", "targetAgentId"]),
  ...group(["broker.request.status_changed"], "lifecycle", ["from", "to", "by"]),
  ...group(["broker.request.closed"], "lifecycle", ["outcome", "escalated"]),
  ...group(["broker.reply.rejected"], "lifecycle", ["code"]),
  ...group(["broker.owner.decided"], "lifecycle", ["decision"]),
  ...group(["wake.attempt"], "wake", ["kind", "attempt", "ok", "httpStatus", "code"]),
  ...group(["wake.exhausted"], "wake", ["kind", "attempts"]),
  ...group(["coordination.tool.call"], "tool", ["tool", "outcome"]),
  ...group(["error"], "error", ["operation", "type", "issues", "frames", "code"]),
  ...group(
    ["admin.login", "admin.logout", "admin.reveal", "admin.action", "admin.token.created", "admin.token.revoked", "admin.mcp.call"],
    "admin",
    ["action", "target", "tool"],
  ),
  ...group(["telemetry.invalid_event"], "lifecycle", ["event", "issues"]),
]

const NOTES = [
  "Todas las vistas ya vienen redactadas: sin tokens, nonces, secretos de aviso, args, result ni texto libre de terceros.",
  "ops.v_events tiene un evento o span por fila; attrs solo contiene los atributos declarados en el catálogo.",
  "admin_sql acepta un solo SELECT/WITH sobre estas vistas, con 3 s de límite y 200 filas como máximo.",
]

function staticViews(): SchemaView[] {
  return Object.entries(STATIC_VIEWS).map(([name, columns]) => ({
    name: `ops.${name}`,
    columns: columns.map((column) => ({ name: column, type: null })),
  }))
}

function viewsFromRows(rows: unknown[][]): SchemaView[] {
  const views = new Map<string, SchemaView>()
  for (const [table, column, type] of rows) {
    if (typeof table !== "string" || typeof column !== "string" || HIDDEN_VIEWS.has(table)) continue
    const name = `ops.${table}`
    const view = views.get(name) ?? { name, columns: [] }
    view.columns.push({ name: column, type: typeof type === "string" ? type : null })
    views.set(name, view)
  }
  return [...views.values()]
}

export async function loadAdminSchema(queries: AdminQueries): Promise<AdminSchema> {
  try {
    const result = await queries.sql(COLUMNS_SQL)
    const views = viewsFromRows(result.rows)
    if (views.length > 0) return { source: "information_schema", views, events: EVENT_CATALOG, notes: NOTES }
  } catch {
    // Sin acceso a information_schema (por ejemplo, vistas aún sin migrar): lista estática.
    // TODO(admin): telemetry.error("mcp admin schema", error) al conectar @team-31/telemetry en admin.
  }
  return { source: "static", views: staticViews(), events: EVENT_CATALOG, notes: NOTES }
}
