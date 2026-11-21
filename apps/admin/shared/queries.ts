// AdminQueries: el módulo profundo de lectura del admin. Lo implementa server/queries
// (sobre las vistas ops.v_* con el rol de solo lectura) y lo consumen dos adaptadores
// delgados: la API HTTP (server/api) y el MCP de administración (server/mcp).
// Los adaptadores no escriben SQL ni conocen las vistas: solo llaman a esta interfaz.
import type {
  AgentRow,
  AuditEntry,
  ErrorGroup,
  EventFilters,
  FlowRequestRef,
  FlowSnapshot,
  Overview,
  RequestDetail,
  RequestFilters,
  RequestSummary,
  ServiceHealth,
  SqlResult,
  TelemetryEvent,
  Trace,
  UserDetail,
  UserSummary,
  WakeJobRow,
  Window,
  AgentFilters,
  ErrorFilters,
  UserFilters,
} from "./contract.js"
import type { z } from "zod"

export type Page<T> = { items: T[]; nextCursor: string | null }

export interface AdminQueries {
  overview(window: Window): Promise<Overview>
  services(): Promise<ServiceHealth[]>

  requests(filters: RequestFilters): Promise<Page<RequestSummary>>
  // null si no existe.
  request(id: string): Promise<RequestDetail | null>

  trace(traceId: string): Promise<Trace | null>
  // names: solo esos nombres (uso interno de los streams; no está en EventFilters del contrato).
  events(filters: EventFilters & { names?: readonly string[] }): Promise<TelemetryEvent[]>
  // Último id de ops.events (null si está vacía).
  latestEventId(): Promise<string | null>
  errors(filters: z.infer<typeof ErrorFilters>): Promise<ErrorGroup[]>
  error(errorId: string): Promise<TelemetryEvent | null>

  users(filters: z.infer<typeof UserFilters>): Promise<Page<UserSummary>>
  // Acepta user id o dirección Sideband.
  user(idOrAddress: string): Promise<UserDetail | null>
  agents(filters: z.infer<typeof AgentFilters>): Promise<AgentRow[]>
  wakeQueue(state?: WakeJobRow["state"]): Promise<WakeJobRow[]>

  audit(cursor?: string): Promise<Page<AuditEntry>>

  // Flujo en vivo: foto de la red (personas, agentes, solicitudes recientes) con su cursor.
  flowSnapshot(): Promise<FlowSnapshot>
  // Quién pregunta y a quién de cada solicitud (máximo 200 ids; las que no existen se omiten).
  requestRefs(ids: readonly string[]): Promise<FlowRequestRef[]>

  // SELECT de solo lectura sobre ops.v_* (excepto ops.v_request_payloads).
  // statement_timeout 3 s, máximo 200 filas. Lanza AdminQueryError("invalid_input") si no es un SELECT.
  sql(sql: string): Promise<SqlResult>
}

export class AdminQueryError extends Error {
  readonly code: "invalid_input" | "not_found" | "timeout"

  constructor(code: AdminQueryError["code"], message: string) {
    super(message)
    this.code = code
  }
}
