// Cliente tipado de la API del admin. Lee la tabla `adminRoutes` del contrato: arma la URL
// con params y query, envía la cookie de sesión, valida la respuesta con el esquema zod de la
// ruta y traduce `ErrorBody` a `ApiError`. Con VITE_ADMIN_MOCK=1 responde con fixtures.
import {
  adminRoutes,
  ErrorBody,
  TelemetryEvent,
  type AdminRouteName,
} from "@shared/contract"
import type { z } from "zod"

type Routes = typeof adminRoutes
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

async function toApiError(response: Response): Promise<ApiError> {
  const json: unknown = await response.json().catch(() => null)
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

export async function api<N extends AdminRouteName>(
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
  let response: Response
  try {
    response = await fetch(url, {
      method: route.method,
      credentials: "include",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error
    throw new ApiError("network", "No se pudo contactar al servidor admin.", 0)
  }
  if (!response.ok) throw await toApiError(response)
  return parseResponse(name, await response.json())
}

function parseResponse<N extends AdminRouteName>(
  name: N,
  data: unknown
): ApiOutput<N> {
  const schema = adminRoutes[name].response as z.ZodType
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    console.warn(`[admin] respuesta inválida en ${name}`, parsed.error.issues)
    throw new ApiError(
      "invalid_response",
      `La respuesta de ${name} no cumple el contrato.`,
      200
    )
  }
  return parsed.data as ApiOutput<N>
}

// ---------- Auth (Better Auth del servidor admin) ----------

export async function signInWithGoogle(callbackURL = "/"): Promise<void> {
  if (isMock) {
    const { mockDevLogin } = await import("@/mocks/handlers")
    await mockDevLogin()
    return
  }
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL }),
  })
  if (!response.ok) throw await toApiError(response)
  const data = (await response.json().catch(() => ({}))) as { url?: string }
  if (data.url) window.location.assign(data.url)
}

// true si el servidor tiene dev auth (ADMIN_DEV_AUTH=1): GET responde {enabled:true}; si no, 404.
export async function probeDevLogin(): Promise<boolean> {
  if (isMock) return true
  try {
    const response = await fetch("/api/admin/dev-login", {
      method: "GET",
      credentials: "include",
    })
    if (!response.ok) return false
    const data = (await response.json().catch(() => null)) as {
      enabled?: boolean
    } | null
    return data?.enabled === true
  } catch {
    return false
  }
}

export async function devLogin(): Promise<void> {
  if (isMock) {
    const { mockDevLogin } = await import("@/mocks/handlers")
    await mockDevLogin()
    return
  }
  const response = await fetch("/api/admin/dev-login", {
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
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
}

// ---------- En vivo (SSE) ----------

export type LiveFilters = z.input<Routes["live"]["query"]>
export type LiveStatus = "connecting" | "open" | "error"
export type LiveHandlers = {
  onEvent: (event: TelemetryEvent) => void
  onStatus: (status: LiveStatus) => void
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
  source.addEventListener("telemetry", (message) => {
    try {
      const parsed = TelemetryEvent.safeParse(
        JSON.parse((message as MessageEvent<string>).data)
      )
      if (parsed.success) handlers.onEvent(parsed.data)
    } catch {
      // Mensaje mal formado: se ignora, el stream sigue.
    }
  })
  return () => source.close()
}
