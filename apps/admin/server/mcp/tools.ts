// Tools del MCP de administración (docs/admin.md, sección 6). Son adaptadores delgados
// sobre AdminQueries: validan la entrada con los esquemas del contrato (argumentos en
// snake_case), auditan, verifican el scope y devuelven structuredContent más un resumen.
import {
  AgentFilters,
  ErrorFilters,
  EventFilters,
  RequestFilters,
  SqlInput,
  UserFilters,
  WakeJobRow,
  Window,
  adminRoutes,
  type AdminTokenScope,
} from "../../shared/contract.js"
import type { AdminQueries } from "../../shared/queries.js"
import { z } from "zod"
import * as text from "./format.js"

export type ToolOutcome<T> = { data: T; text: string } | { notFound: string }

export type AdminTool<I extends z.ZodObject, O extends z.ZodObject> = {
  name: string
  title: string
  description: string
  input: I
  output: O
  // Scope adicional. Toda tool exige lectura (admin:read, o admin:sql que la incluye).
  scope?: AdminTokenScope
  // Qué queda como target en la auditoría.
  target?: (args: z.output<I>) => string | null
  run: (args: z.output<I>) => Promise<ToolOutcome<z.input<O>>>
}

type RegisterTool = <I extends z.ZodObject, O extends z.ZodObject>(spec: AdminTool<I, O>) => void

const id = (what: string) => z.string().min(1).max(200).describe(what)
const found = <T>(value: T | null, missing: string, summarize: (v: T) => string): ToolOutcome<T> =>
  value === null ? { notFound: missing } : { data: value, text: summarize(value) }

function registerOverviewTools(queries: AdminQueries, tool: RegisterTool) {
  tool({
    name: "admin_overview",
    title: "Resumen de Sideband",
    description: "Empieza aquí: salud de servicios, solicitudes por estado, atascadas, p50/p95 hasta el estado final, avisos por adaptador, errores principales y rate limits en la ventana.",
    input: z.object({
      window: Window.default("1h").describe("Ventana de tiempo: 15m, 1h, 24h o 7d. Por defecto 1h."),
    }),
    output: adminRoutes.overview.response,
    run: async ({ window }) => {
      const data = await queries.overview(window)
      return { data, text: text.overviewText(data) }
    },
  })

  tool({
    name: "admin_services",
    title: "Servicios",
    description: "Último latido por servicio e instancia (up < 60 s, stale < 5 min, down).",
    input: z.object({}),
    output: adminRoutes.services.response,
    run: async () => {
      const items = await queries.services()
      return { data: { items }, text: text.servicesText(items) }
    },
  })
}

function registerRequestTools(queries: AdminQueries, tool: RegisterTool) {
  tool({
    name: "admin_search_requests",
    title: "Buscar solicitudes",
    description: "Busca solicitudes por estado, herramienta, dirección (origen o destino), prefijo de id, rango de fechas o atascadas. Pagina con cursor.",
    input: z.object({
      status: RequestFilters.shape.status.describe("Estados a incluir (awaiting_agent, awaiting_owner, answered, no_data, declined, denied, expired, delivery_failed)."),
      tool: RequestFilters.shape.tool.describe("Herramienta: profile, availability, question, interest_check o connect."),
      address: RequestFilters.shape.address.describe("Dirección Sideband que coincide con origen o destino."),
      q: RequestFilters.shape.q.describe("Prefijo del request id."),
      stuck: z.boolean().optional().describe("true para ver solo las abiertas con plazo vencido."),
      since: RequestFilters.shape.since.describe("Desde (ISO 8601 con zona)."),
      until: RequestFilters.shape.until.describe("Hasta (ISO 8601 con zona)."),
      cursor: RequestFilters.shape.cursor.describe("nextCursor de la página anterior."),
      limit: RequestFilters.shape.limit.describe("Máximo de resultados (1 a 200, 50 por defecto)."),
    }),
    output: adminRoutes.requests.response,
    run: async (args) => {
      const data = await queries.requests(args)
      return { data, text: text.requestsText(data) }
    },
  })

  tool({
    name: "admin_get_request",
    title: "Detalle de solicitud",
    description: "Línea de tiempo completa (eventos de la solicitud y telemetría), avisos, campos permitidos y descartados, decisión de política y trazas. Nunca incluye el payload.",
    input: z.object({ request_id: id("Id de la solicitud.") }),
    output: adminRoutes.request.response,
    target: (args) => args.request_id,
    run: async ({ request_id }) =>
      found(await queries.request(request_id), `No existe la solicitud «${request_id}». Búscala con admin_search_requests.`, text.requestText),
  })

  tool({
    name: "admin_get_trace",
    title: "Traza",
    description: "Spans de todos los servicios para una traza (trace_id de una solicitud, evento o error).",
    input: z.object({ trace_id: id("Id de la traza (W3C, 32 hex).") }),
    output: adminRoutes.trace.response,
    target: (args) => args.trace_id,
    run: async ({ trace_id }) =>
      found(await queries.trace(trace_id), `No existe la traza «${trace_id}» (puede haber expirado por retención).`, text.traceText),
  })
}

function registerTelemetryTools(queries: AdminQueries, tool: RegisterTool) {
  tool({
    name: "admin_events",
    title: "Eventos de telemetría",
    description: "Historial de ops.events filtrado por servicio, tipo, nombre, nivel, solicitud, persona o traza. after_id avanza (tail) y before_id retrocede.",
    input: z.object({
      service: EventFilters.shape.service.describe("web, mcp, broker, worker, admin o coordination."),
      kind: EventFilters.shape.kind.describe("http, tool, lifecycle, wake, policy, auth, error o admin."),
      name: EventFilters.shape.name.describe("Nombre exacto del evento (ver admin://schema)."),
      level: EventFilters.shape.level.describe("debug, info, warn o error."),
      request_id: EventFilters.shape.requestId.describe("Id de solicitud."),
      user_id: EventFilters.shape.userId.describe("Id de persona."),
      trace_id: EventFilters.shape.traceId.describe("Id de traza."),
      after_id: EventFilters.shape.afterId.describe("Solo eventos con id mayor que este."),
      before_id: EventFilters.shape.beforeId.describe("Solo eventos con id menor que este."),
      limit: EventFilters.shape.limit.describe("Máximo de eventos (1 a 500, 100 por defecto)."),
    }),
    output: adminRoutes.events.response,
    run: async (args) => {
      const items = await queries.events({
        service: args.service,
        kind: args.kind,
        name: args.name,
        level: args.level,
        requestId: args.request_id,
        userId: args.user_id,
        traceId: args.trace_id,
        afterId: args.after_id,
        beforeId: args.before_id,
        limit: args.limit,
      })
      return { data: { items }, text: text.eventsText(items) }
    },
  })

  tool({
    name: "admin_errors",
    title: "Errores agrupados",
    description: "Errores agrupados por servicio, operación y tipo en la ventana, con un errorId de muestra.",
    input: z.object({
      window: ErrorFilters.shape.window.describe("Ventana: 15m, 1h, 24h o 7d. Por defecto 24h."),
      service: ErrorFilters.shape.service.describe("Filtra por servicio."),
      operation: ErrorFilters.shape.operation.describe("Filtra por operación (por ejemplo «POST /v1/agent/reply»)."),
    }),
    output: adminRoutes.errors.response,
    run: async (filters) => {
      const items = await queries.errors(filters)
      return { data: { items }, text: text.errorsText(items, filters.window) }
    },
  })

  tool({
    name: "admin_get_error",
    title: "Detalle de error",
    description: "Un error por su errorId (el que los servicios devuelven en X-Error-Id): operación, tipo, frames, solicitud y traza.",
    input: z.object({ error_id: id("errorId (uuid).") }),
    output: adminRoutes.error.response,
    target: (args) => args.error_id,
    run: async ({ error_id }) =>
      found(await queries.error(error_id), `No existe el error «${error_id}» (puede haber expirado por retención).`, text.errorText),
  })
}

function registerUserTools(queries: AdminQueries, tool: RegisterTool) {
  tool({
    name: "admin_search_users",
    title: "Buscar personas",
    description: "Busca personas por dirección Sideband, nombre o id. Pagina con cursor.",
    input: z.object({
      q: UserFilters.shape.q.describe("Texto a buscar en dirección, nombre o id."),
      cursor: UserFilters.shape.cursor.describe("nextCursor de la página anterior."),
      limit: UserFilters.shape.limit.describe("Máximo de resultados (1 a 200, 50 por defecto)."),
    }),
    output: adminRoutes.users.response,
    run: async (args) => {
      const data = await queries.users(args)
      return { data, text: text.usersText(data) }
    },
  })

  tool({
    name: "admin_get_user",
    title: "Detalle de persona",
    description: "Persona por user id o dirección Sideband: identidad, clientes OAuth, reglas, agentes y solicitudes recientes.",
    input: z.object({ id_or_address: id("User id o dirección Sideband.") }),
    output: adminRoutes.user.response,
    target: (args) => args.id_or_address,
    run: async ({ id_or_address }) =>
      found(await queries.user(id_or_address), `No existe la persona «${id_or_address}». Búscala con admin_search_users.`, text.userText),
  })

  tool({
    name: "admin_agents",
    title: "Conexiones de agentes",
    description: "Conexiones de agentes con su adaptador de aviso y avisos ok/fallidos en 24 h.",
    input: z.object({
      failing: z.boolean().optional().describe("true para ver solo las que tienen avisos fallando."),
      kind: AgentFilters.shape.kind.describe("Adaptador de aviso."),
    }),
    output: adminRoutes.agents.response,
    run: async (args) => {
      const items = await queries.agents(args)
      return { data: { items }, text: text.agentsText(items) }
    },
  })
}

function registerOperationsTools(queries: AdminQueries, tool: RegisterTool) {
  tool({
    name: "admin_wake_queue",
    title: "Cola de avisos",
    description: "Trabajos de aviso (wake_jobs) en cola, corriendo o terminados.",
    input: z.object({
      state: WakeJobRow.shape.state.optional().describe("queued, running o done."),
    }),
    output: adminRoutes.wakeQueue.response,
    run: async ({ state }) => {
      const items = await queries.wakeQueue(state)
      return { data: { items }, text: text.wakeQueueText(items) }
    },
  })

  tool({
    name: "admin_sql",
    title: "SQL de solo lectura",
    description: "Un solo SELECT/WITH sobre las vistas ops.v_* (ver admin://schema). Límite de 3 s y 200 filas. Requiere el scope admin:sql.",
    input: z.object({ sql: SqlInput.shape.sql.describe("Consulta SELECT o WITH.") }),
    output: adminRoutes.sql.response,
    scope: "admin:sql",
    run: async ({ sql }) => {
      const data = await queries.sql(sql)
      return { data, text: text.sqlText(data) }
    },
  })
}

export function registerAdminTools(queries: AdminQueries, tool: RegisterTool): void {
  registerOverviewTools(queries, tool)
  registerRequestTools(queries, tool)
  registerTelemetryTools(queries, tool)
  registerUserTools(queries, tool)
  registerOperationsTools(queries, tool)
}
