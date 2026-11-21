// Resúmenes cortos en español para el bloque de texto de cada tool. El dato completo
// viaja en structuredContent; aquí solo va lo que un agente necesita para decidir el
// siguiente paso.
import type {
  AgentRow,
  ErrorGroup,
  Overview,
  RequestDetail,
  RequestSummary,
  ServiceHealth,
  SqlResult,
  TelemetryEvent,
  Trace,
  UserDetail,
  UserSummary,
  WakeJobRow,
} from "../../shared/contract.js"
import type { Page } from "../../shared/queries.js"

export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `hace ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} d`
}

export function ms(value: number | null): string {
  if (value === null) return "s/d"
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].map(([name, n]) => `${n} ${name}`).join(", ")
}

const more = (cursor: string | null) => (cursor ? ` Hay más resultados: usa cursor="${cursor}".` : "")

const errorLabel = (e: ErrorGroup) => `${e.service} ${e.operation} ${e.type} ×${e.count}`

export function overviewText(o: Overview): string {
  const down = o.services.filter((s) => s.state !== "up")
  const services = down.length === 0
    ? `${plural(o.services.length, "instancia", "instancias")} arriba`
    : `${plural(down.length, "instancia", "instancias")} sin latido reciente: ${down.map((s) => `${s.service}@${s.instance} (${s.state})`).join(", ")}`
  const wakesFailed = o.wakes.reduce((sum, w) => sum + w.failed, 0)
  const top = o.errors.top[0]
  return [
    `Ventana ${o.window}: ${plural(o.requests.total, "solicitud", "solicitudes")} (${o.requests.open} abiertas, ${o.requests.stuck} atascadas); p50/p95 hasta estado final ${ms(o.requests.timeToFinalMs.p50)} / ${ms(o.requests.timeToFinalMs.p95)}.`,
    `Servicios: ${services}.`,
    `Avisos fallidos: ${wakesFailed}. Rate limited: ${o.rateLimited}.`,
    `Errores: ${o.errors.total}${top ? ` (principal: ${errorLabel(top)})` : ""}.`,
    o.requests.stuck > 0 ? "Siguiente paso: admin_search_requests con stuck=true." : "",
  ].filter(Boolean).join(" ")
}

export function servicesText(items: ServiceHealth[]): string {
  if (items.length === 0) return "No hay latidos registrados."
  const down = items.filter((s) => s.state !== "up")
  const detail = down.map((s) => `${s.service}@${s.instance} ${s.state}, último latido ${ago(s.lastSeenAt)}`).join("; ")
  return `${plural(items.length, "instancia", "instancias")}: ${countBy(items, (s) => s.state)}.${detail ? ` ${detail}.` : ""}`
}

export function requestsText(page: Page<RequestSummary>): string {
  if (page.items.length === 0) return "No hay solicitudes con esos filtros."
  const stuck = page.items.filter((r) => r.stuck)
  const oldest = [...stuck].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const stuckText = oldest
    ? ` ${plural(stuck.length, "atascada", "atascadas")}; la más vieja ${oldest.id} (${oldest.tool}, ${oldest.status}) ${ago(oldest.createdAt)}.`
    : ""
  return `${plural(page.items.length, "solicitud", "solicitudes")}: ${countBy(page.items, (r) => r.status)}.${stuckText}${more(page.nextCursor)}`
}

export function requestText(d: RequestDetail): string {
  const s = d.summary
  const errors = d.timeline.filter((t) => t.level === "error").length
  const failedWakes = d.wakes.filter((w) => w.ok === false).length
  return [
    `${s.id} · ${s.tool} · ${s.fromAddress} → ${s.toAddress} · ${s.status}${s.stuck ? " (atascada)" : ""}, creada ${ago(s.createdAt)}, duración ${ms(s.durationMs)}.`,
    `Regla ${s.rule}${s.escalated ? ", escalada al dueño" : ""}. ${plural(d.timeline.length, "evento", "eventos")} en la línea de tiempo (${errors} con error), ${plural(d.wakes.length, "aviso", "avisos")} (${failedWakes} fallidos).`,
    d.traceIds.length > 0 ? `Trazas: ${d.traceIds.join(", ")} (usa admin_get_trace).` : "Sin trazas asociadas.",
  ].join(" ")
}

export function traceText(t: Trace): string {
  const errors = t.spans.filter((s) => s.level === "error" || s.errorId !== null)
  const root = t.spans.find((s) => s.parentSpanId === null)
  const services = [...new Set(t.spans.map((s) => s.service))].join(", ")
  const errorText = errors.length > 0
    ? ` ${plural(errors.length, "span con error", "spans con error")}: ${errors.slice(0, 3).map((s) => `${s.service} ${s.name}${s.errorId ? ` (error ${s.errorId})` : ""}`).join("; ")}.`
    : " Sin errores."
  return `Traza ${t.traceId}: ${plural(t.spans.length, "span", "spans")} en ${services || "ningún servicio"}${root ? `; raíz ${root.service} ${root.name} ${ms(root.durationMs)}` : ""}.${errorText}`
}

export function eventsText(items: TelemetryEvent[]): string {
  if (items.length === 0) return "No hay eventos con esos filtros."
  const last = items.reduce((a, b) => (a.at > b.at ? a : b))
  // Ids bigint como string: el menor es el más corto y, a igual largo, el menor lexicográfico.
  const min = items.map((e) => e.id).reduce((a, b) => (a.length < b.length || (a.length === b.length && a < b) ? a : b))
  return `${plural(items.length, "evento", "eventos")} (${countBy(items, (e) => e.level)}). Más reciente: ${last.service} ${last.name} ${ago(last.at)}. Para seguir hacia atrás usa before_id="${min}".`
}

export function errorsText(items: ErrorGroup[], window: string): string {
  if (items.length === 0) return `Sin errores en ${window}.`
  const top = [...items].sort((a, b) => b.count - a.count)[0]!
  return `${plural(items.length, "grupo de errores", "grupos de errores")} en ${window}. El más frecuente: ${errorLabel(top)}, último ${ago(top.lastAt)} (detalle: admin_get_error error_id="${top.sampleErrorId}").`
}

export function errorText(e: TelemetryEvent): string {
  const operation = e.attrs.operation ?? e.name
  const type = e.attrs.type ?? "error"
  return `Error ${e.errorId ?? e.id} en ${e.service}: ${String(operation)} ${String(type)}, ${ago(e.at)}.${e.requestId ? ` Solicitud ${e.requestId}.` : ""}${e.traceId ? ` Traza ${e.traceId}.` : ""}`
}

export function usersText(page: Page<UserSummary>): string {
  if (page.items.length === 0) return "No hay personas con esa búsqueda."
  const names = page.items.slice(0, 5).map((u) => u.address ?? u.userId).join(", ")
  return `${plural(page.items.length, "persona", "personas")}: ${names}${page.items.length > 5 ? "…" : ""}.${more(page.nextCursor)}`
}

export function userText(u: UserDetail): string {
  const s = u.summary
  const failing = u.agents.filter((a) => a.wakes24h.failed > 0).length
  return `${s.address ?? s.userId}${s.displayName ? ` (${s.displayName})` : ""}: ${plural(u.agents.length, "agente", "agentes")} (${failing} con avisos fallando), ${u.identity.activeSessions} sesiones activas, ${u.identity.oauthClients.length} clientes OAuth, ${s.sent24h} enviadas y ${s.received24h} recibidas en 24 h, ${plural(u.recentRequests.length, "solicitud reciente", "solicitudes recientes")}.`
}

export function agentsText(items: AgentRow[]): string {
  if (items.length === 0) return "No hay conexiones de agentes con esos filtros."
  const failing = items.filter((a) => a.wakes24h.failed > 0)
  const detail = failing.slice(0, 5).map((a) => `${a.userId}/${a.agentId} (${a.wakeKind}, ${a.wakes24h.failed} fallidos)`).join(", ")
  return `${plural(items.length, "conexión", "conexiones")}, ${failing.length} con avisos fallando en 24 h${detail ? `: ${detail}` : ""}.`
}

export function wakeQueueText(items: WakeJobRow[]): string {
  if (items.length === 0) return "La cola de avisos está vacía."
  const failed = items.filter((w) => w.ok === false).length
  return `${plural(items.length, "trabajo", "trabajos")}: ${countBy(items, (w) => w.state)}; ${failed} fallidos.`
}

export function sqlText(r: SqlResult): string {
  return `${plural(r.rows.length, "fila", "filas")}${r.truncated ? " (truncado a 200)" : ""} en ${ms(r.durationMs)}. Columnas: ${r.columns.join(", ") || "ninguna"}.`
}
