// Cliente tipado de la API del admin. Lee la tabla `adminRoutes` del contrato: arma la URL
// con params y query, envía la cookie de sesión, valida la respuesta con el esquema zod de la
// ruta y traduce `ErrorBody` a `ApiError`. Con VITE_ADMIN_MOCK=1 responde con fixtures.
import {
  adminRoutes,
  ErrorBody,
  FlowRequestRef,
  FlowReset,
  TelemetryEvent,
  type AdminRouteName,
} from "@shared/contract"
import { isFlowRow } from "@team-31/agent-flow/telemetry"
import { z } from "zod"

type Routes = typeof adminRoutes
type JsonRouteName = {
  [N in AdminRouteName]: Routes[N] extends { contentType: "text/event-stream" } ? never : N
}[AdminRouteName]
type Route<N extends AdminRouteName> = Routes[N]

type ParamsPart<N extends AdminRouteName> =
  Route<N> extends { params: infer P extends z.ZodType }
    ? { params: z.input<P> }
    : { params?: never }
type QueryPart<N extends AdminRouteName> =
  Route<N> extends { query: infer Q extends z.ZodType }
    ? { query?: Partial<z.input<Q>> }
    : { query?: never }
type BodyPart<N extends AdminRouteName> =
  Route<N> extends { body: infer B extends z.ZodType }
    ? { body: z.input<B> }
    : { body?: never }

export type ApiInput<N extends AdminRouteName> = ParamsPart<N> &
  QueryPart<N> &
  BodyPart<N>
export type ApiOutput<N extends AdminRouteName> = z.output<Route<N>["response"]>
type ApiArgs<N extends AdminRouteName> =
  object extends ApiInput<N>
    ? [input?: ApiInput<N>, options?: ApiOptions]
    : [input: ApiInput<N>, options?: ApiOptions]
type ApiOptions = { signal?: AbortSignal }

export type ApiErrorCode =
  z.infer<typeof ErrorBody>["error"]["code"] | "network" | "invalid_response"

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly errorId?: string

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    errorId?: string
  ) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.errorId = errorId
  }
}

export const isMock = import.meta.env.VITE_ADMIN_MOCK === "1"

export function isApiError(
  error: unknown,
  code?: ApiErrorCode
): error is ApiError {
  return (
    error instanceof ApiError && (code === undefined || error.code === code)
  )
}

export function buildPath(
  path: string,
  params?: Record<string, string>
): string {
  return path.replace(/:(\w+)/g, (_, key: string) => {
    const value = params?.[key]
    if (value === undefined)
      throw new Error(`Falta el parámetro ${key} para ${path}`)
    return encodeURIComponent(value)
  })
}

export function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return ""
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    // z.coerce.boolean() convierte "false" en true: los booleanos falsos se omiten.
    if (value === false) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
      continue
    }
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

const statusCodes: Record<number, ApiErrorCode> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
  502: "upstream",
  503: "upstream",
}

function networkError(error: unknown): never {
  if (error instanceof Error && error.name === "AbortError") throw error
  throw new ApiError("network", "No se pudo contactar al servidor admin.", 0)
}

async function request(url: string, init: RequestInit) {
  try {
    return await fetch(url, init)
  } catch (error) {
    return networkError(error)
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const json: unknown = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return null
    return networkError(error)
  })
  const parsed = ErrorBody.safeParse(json)
  if (parsed.success) {
    const { code, message, errorId } = parsed.data.error
    return new ApiError(code, message, response.status, errorId)
  }
  const code =
    statusCodes[response.status] ??
    (response.status >= 500 ? "internal" : "invalid_input")
  return new ApiError(
    code,
    `Error ${response.status}`,
    response.status,
    response.headers.get("X-Error-Id") ?? undefined
  )
}

export async function api<N extends JsonRouteName>(
  name: N,
  ...args: ApiArgs<N>
): Promise<ApiOutput<N>> {
  const [input, options] = args
  const route = adminRoutes[name]
  const { params, query, body } = (input ?? {}) as {
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: unknown
  }

  if (isMock) {
    const { mockApi } = await import("@/mocks/handlers")
    const data = await mockApi(name, { params, query, body })
    return parseResponse(name, data)
  }

  const url = buildPath(route.path, params) + buildQuery(query)
  const response = await request(url, {
    method: route.method,
    credentials: "include",
    headers:
      body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  })
  if (!response.ok) throw await toApiError(response)
  return parseResponse(name, await readJson(name, response), response)
}

function invalidResponse(name: string, response?: Response) {
  return new ApiError(
    "invalid_response",
    `La respuesta de ${name} no cumple el contrato.`,
    response?.status ?? 200,
    response?.headers.get("X-Error-Id") ?? undefined
  )
}

async function readJson(name: string, response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidResponse(name, response)
    return networkError(error)
  }
}

function parseResponse<N extends AdminRouteName>(
  name: N,
  data: unknown,
  response?: Response
): ApiOutput<N> {
  const schema = adminRoutes[name].response as z.ZodType
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw invalidResponse(name, response)
  return parsed.data as ApiOutput<N>
}

// ---------- Auth (Better Auth del servidor admin) ----------

export async function signInWithGoogle(callbackURL = "/"): Promise<void> {
  if (isMock) {
    const { mockDevLogin } = await import("@/mocks/handlers")
    await mockDevLogin()
    return
  }
  const response = await request("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL }),
  })
  if (!response.ok) throw await toApiError(response)
  const redirect = z.object({ url: z.url({ protocol: /^https$/ }) })
    .safeParse(await readJson("sign-in/social", response))
  if (!redirect.success) throw invalidResponse("sign-in/social", response)
  window.location.assign(redirect.data.url)
}

// true si el servidor tiene dev auth (ADMIN_DEV_AUTH=1): GET responde {enabled:true}; si no, 404.
export async function probeDevLogin(): Promise<boolean> {
  if (isMock) return true
  const response = await request("/api/admin/dev-login", {
    method: "GET",
    credentials: "include",
  })
  if (response.status === 404) return false
  if (!response.ok) throw await toApiError(response)
  const probe = z.object({ enabled: z.boolean() }).safeParse(await readJson("dev-login", response))
  if (!probe.success) throw invalidResponse("dev-login", response)
  return probe.data.enabled
}

export async function devLogin(): Promise<void> {
  if (isMock) {
    const { mockDevLogin } = await import("@/mocks/handlers")
    await mockDevLogin()
    return
  }
  const response = await request("/api/admin/dev-login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!response.ok) throw await toApiError(response)
}

export async function signOut(): Promise<void> {
  if (isMock) {
    const { mockSignOut } = await import("@/mocks/handlers")
    await mockSignOut()
    return
  }
  const response = await request("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!response.ok) throw await toApiError(response)
}

// ---------- En vivo (SSE) ----------

export type LiveFilters = z.input<Routes["live"]["query"]>
export type LiveStatus = "connecting" | "open" | "error"
export type LiveHandlers = {
  onEvent: (event: TelemetryEvent) => void
  onStatus: (status: LiveStatus) => void
}

const parseStreamEvent = <T>(schema: z.ZodType<T>, message: Event): T | undefined => {
  try {
    const parsed = schema.safeParse(
      JSON.parse((message as MessageEvent<string>).data)
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function listenFor<T>(
  source: EventSource,
  name: string,
  schema: z.ZodType<T>,
  receive: (event: T) => void
) {
  source.addEventListener(name, (message) => {
    const event = parseStreamEvent(schema, message)
    if (event !== undefined) receive(event)
  })
}

// Se suscribe a /api/admin/live. Devuelve la función para cerrar la conexión.
export function subscribeLive(
  filters: LiveFilters,
  handlers: LiveHandlers
): () => void {
  if (isMock) {
    let stop: (() => void) | undefined
    let closed = false
    handlers.onStatus("connecting")
    void import("@/mocks/live").then(({ startMockLive }) => {
      if (closed) return
      stop = startMockLive(filters, handlers)
    })
    return () => {
      closed = true
      stop?.()
    }
  }

  const url = adminRoutes.live.path + buildQuery(filters)
  const source = new EventSource(url, { withCredentials: true })
  handlers.onStatus("connecting")
  source.onopen = () => handlers.onStatus("open")
  source.onerror = () =>
    handlers.onStatus(
      source.readyState === EventSource.CLOSED ? "error" : "connecting"
    )
  listenFor(source, "telemetry", TelemetryEvent, (row) => handlers.onEvent(row))
  return () => source.close()
}

// ---------- Flujo en vivo (SSE) ----------

export type FlowStreamHandlers = {
  // Conectado (también tras una reconexión automática del navegador).
  onOpen: () => void
  // La conexión se cayó y el navegador reintenta solo (con Last-Event-ID).
  onRetrying: () => void
  // El navegador dejó de reintentar (401, 403, 429, 5xx): el llamador decide.
  onClosed: () => void
  onRow: (row: TelemetryEvent) => void
  onRequest: (ref: FlowRequestRef) => void
  onReset: (cursor: string | null) => void
}

// Se suscribe a /api/admin/flow/live desde `after` (FlowSnapshot.cursor o el último id visto).
export function subscribeFlow(
  after: string | null,
  handlers: FlowStreamHandlers
): () => void {
  if (isMock) {
    return subscribeLive({}, {
      onStatus(status) {
        if (status === "open") handlers.onOpen()
      },
      onEvent(row) {
        if (isFlowRow(row)) handlers.onRow(row)
      },
    })
  }

  const url =
    adminRoutes.flowLive.path + buildQuery({ after: after ?? undefined })
  const source = new EventSource(url, { withCredentials: true })
  source.onopen = () => handlers.onOpen()
  source.onerror = () =>
    source.readyState === EventSource.CLOSED
      ? handlers.onClosed()
      : handlers.onRetrying()
  listenFor(source, "telemetry", TelemetryEvent, (row) => handlers.onRow(row))
  listenFor(source, "request", FlowRequestRef, (ref) => handlers.onRequest(ref))
  listenFor(source, "reset", FlowReset, (reset) => handlers.onReset(reset.cursor))
  return () => source.close()
}
