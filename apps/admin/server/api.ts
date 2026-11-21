import { getConnInfo } from "@hono/node-server/conninfo"
import type { Telemetry } from "@team-31/telemetry"
import { Hono, type Context } from "hono"
import type { z } from "zod"
import { adminRoutes, ErrorBody, PayloadReveal, type AdminRole, type AdminRouteName } from "../shared/contract.js"
import { AdminQueryError, type AdminQueries } from "../shared/queries.js"
import { DEV_EMAIL, type AdminAuth, type RoleResolver } from "./auth/index.js"
import type { AuditActor, AuditLog } from "./audit.js"
import type { BrokerAdminClient } from "./broker.js"
import { AdminHttpError, statusOf } from "./errors.js"
import { flowEventNames, isFlowRow, projectFlowRow } from "@team-31/agent-flow/telemetry"
import { createLiveSlots, liveStream, type LiveOptions } from "./live.js"
import type { AdminLimiters } from "./rate-limit.js"
import type { TokenStore } from "./tokens.js"
import type { Revealer } from "./types.js"

// API HTTP del admin (/api/admin/*). Recorre adminRoutes como apps/broker/src/http/server.ts:
// sesión de navegador → rol → Origin y JSON en mutaciones → sesión fresca → rate limit →
// handler → respuesta validada con el contrato. Ver docs/admin.md#5-api-http.

export type AdminPrincipal = {
  id: string
  email: string
  name: string | null
  image: string | null
  role: AdminRole
  session: { id: string; createdAt: Date; expiresAt: Date }
}

export type AdminApiDeps = {
  auth: AdminAuth
  roleOf: RoleResolver
  queries: AdminQueries
  tokens: TokenStore
  audit: AuditLog
  broker: BrokerAdminClient
  revealer: Revealer
  limiters: AdminLimiters
  telemetry: Telemetry
  adminUrl: string
  freshSeconds: number
  devAuth: boolean
  trustProxy: boolean
  live?: LiveOptions
  now?: () => number
}

type Route = (typeof adminRoutes)[AdminRouteName]
const roleRank: Record<AdminRole, number> = { viewer: 0, operator: 1 }
const mutation = (method: string) => method !== "GET"

function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new AdminHttpError("invalid_input", "La solicitud no cumple el formato requerido.")
  return result.data
}

async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let value: unknown
  try {
    value = await c.req.json()
  } catch {
    throw new AdminHttpError("invalid_input", "El cuerpo debe ser JSON válido.")
  }
  return parseInput(schema, value)
}

// Query string → objeto para los esquemas del contrato. Repetir una llave da un arreglo y
// `status` acepta también valores separados por coma. Los booleanos en "false" se omiten
// porque z.coerce.boolean() los convertiría en true.
function queryInput(c: Context): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {}
  for (const [key, raw] of Object.entries(c.req.queries())) {
    const values = raw.filter((value) => value !== "")
    if (values.length === 0) continue
    if ((key === "stuck" || key === "failing") && values.every((value) => value === "false" || value === "0")) continue
    input[key] = values.length === 1 ? values[0]! : values
  }
  if (typeof input.status === "string") input.status = input.status.split(",")
  return input
}

export function clientIp(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c).remote.address ?? null
  } catch {
    // Fuera de @hono/node-server (pruebas con app.request) no hay socket.
    return null
  }
}

function errorResponse(c: Context, error: unknown, telemetry: Pick<Telemetry, "error" | "emit">) {
  if (error instanceof AdminHttpError) {
    if (error.code === "unauthorized") c.header("WWW-Authenticate", 'Cookie realm="sideband-admin"')
    if (error.retryAfter) c.header("Retry-After", String(error.retryAfter))
    if (error.code === "rate_limited") {
      telemetry.emit("http.rate_limited", { attrs: { route: c.req.routePath, bucket: c.req.path.endsWith("/reveal") ? "reveal" : c.req.path.endsWith("/live") ? "live" : "login" } })
    }
    return c.json(ErrorBody.parse({ error: { code: error.code, message: error.message } }), statusOf[error.code])
  }
  if (error instanceof AdminQueryError) {
    if (error.code === "timeout") {
      return c.json(ErrorBody.parse({ error: { code: "upstream", message: "La consulta superó el tiempo límite." } }), 504)
    }
    return c.json(ErrorBody.parse({ error: { code: error.code, message: error.message } }), statusOf[error.code])
  }
  const errorId = telemetry.error(`${c.req.method} ${c.req.routePath}`, error)
  c.header("X-Error-Id", errorId)
  return c.json(ErrorBody.parse({ error: { code: "internal", message: "Ocurrió un error interno en el admin.", errorId } }), 500)
}

export function createAdminApi(deps: AdminApiDeps) {
  const { auth, roleOf, queries, tokens, audit, broker, revealer, limiters, adminUrl, freshSeconds, telemetry } = deps
  // Los errores esperados (401, 403, 404…) se responden aquí y no llegan a onError, para que
  // honoTelemetry no los registre como errores. Los inesperados devuelven X-Error-Id.
  const guarded = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    try {
      return await handler(c)
    } catch (error) {
      return errorResponse(c, error, telemetry)
    }
  }
  const now = deps.now ?? Date.now
  const api = new Hono()
  // Streams en vivo abiertos por admin (límite en live.ts).
  const liveSlots = createLiveSlots()

  // Flujo en vivo: solo los eventos que dibuja el grafo, con attrs recortados a su lista blanca
  // (packages/agent-flow/src/telemetry.ts) y el resumen de cada solicitud antes de su primer evento.
  function flowLive(c: Context, principal: AdminPrincipal) {
    const { after } = parseInput(adminRoutes.flowLive.query, queryInput(c))
    const known = new Set<string>()
    return liveStream(c, queries, telemetry, liveSlots, {
      stream: "flow",
      principalId: principal.id,
      filters: { names: [...flowEventNames] },
      after,
      backlog: false,
      accept: isFlowRow,
      project: projectFlowRow,
      prelude: async (events) => {
        const ids = [...new Set(events.flatMap((event) => (event.requestId && !known.has(event.requestId) ? [event.requestId] : [])))]
        const refs = []
        for (let i = 0; i < ids.length; i += 200) refs.push(...(await queries.requestRefs(ids.slice(i, i + 200))))
        for (const id of ids) known.add(id)
        while (known.size > 5_000) known.delete(known.values().next().value as string)
        return refs.map((ref) => ({ event: "request", data: ref }))
      },
    }, deps.live)
  }

  // Sesión de Better Auth. Si getSession renueva la sesión (updateAge), reenvía la cookie.
  async function authenticate(c: Context): Promise<AdminPrincipal> {
    const { headers, response } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
    for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true })
    if (!response) throw new AdminHttpError("unauthorized", "Inicia sesión para usar el admin.")
    const role = roleOf(response.user.email)
    if (!role) {
      telemetry.emit("auth.token.rejected", { attrs: { issuer: "admin_session", reason: "not_allowed" } })
      throw new AdminHttpError("forbidden", "Este correo no tiene acceso al admin de Sideband.")
    }
    return {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name || null,
      image: response.user.image ?? null,
      role,
      session: { id: response.session.id, createdAt: new Date(response.session.createdAt), expiresAt: new Date(response.session.expiresAt) },
    }
  }

  const isFresh = (principal: AdminPrincipal) => now() - principal.session.createdAt.getTime() < freshSeconds * 1000
  const actorOf = (principal: AdminPrincipal): AuditActor => ({ type: "admin", id: principal.id, label: principal.email })

  // Mutaciones: Origin = ADMIN_URL y, si llevan cuerpo, Content-Type application/json.
  function requireSameOrigin(c: Context, hasBody: boolean) {
    if (c.req.header("origin") !== adminUrl) {
      throw new AdminHttpError("forbidden", "Origen no permitido.")
    }
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase()
    if (hasBody && contentType !== "application/json") {
      throw new AdminHttpError("invalid_input", "El cuerpo debe ser application/json.")
    }
  }

  async function brokerAction(
    c: Context,
    principal: AdminPrincipal,
    action: string,
    target: string,
    reason: string,
    run: () => Promise<void>,
  ) {
    const entry = { actor: actorOf(principal), action, target, reason, ip: clientIp(c, deps.trustProxy) }
    try {
      await run()
    } catch (error) {
      await audit.record({ ...entry, meta: { ok: false, code: error instanceof AdminHttpError ? error.code : "internal" } })
      throw error
    }
    return { ok: true as const, auditId: await audit.record({ ...entry, meta: { ok: true } }) }
  }

  async function handle(name: AdminRouteName, c: Context, principal: AdminPrincipal): Promise<unknown> {
    const actor = { adminId: principal.id, email: principal.email }
    switch (name) {
      case "session":
        return {
          user: { id: principal.id, email: principal.email, name: principal.name, image: principal.image, role: principal.role },
          session: {
            id: principal.session.id,
            createdAt: principal.session.createdAt.toISOString(),
            expiresAt: principal.session.expiresAt.toISOString(),
            fresh: isFresh(principal),
          },
        }
      case "overview":
        return queries.overview(parseInput(adminRoutes.overview.query, queryInput(c)).window)
      case "services":
        return { items: await queries.services() }
      case "requests":
        return queries.requests(parseInput(adminRoutes.requests.query, queryInput(c)))
      case "request":
        return found(await queries.request(parseInput(adminRoutes.request.params, c.req.param()).id), "No existe la solicitud.")
      case "revealPayload": {
        const { id } = parseInput(adminRoutes.revealPayload.params, c.req.param())
        const { reason } = await parseBody(c, adminRoutes.revealPayload.body)
        const blocked = limiters.reveal.consume(principal.id)
        if (blocked) throw new AdminHttpError("rate_limited", "Alcanzaste el máximo de 10 revelaciones por hora.", blocked)
        // Se audita antes de leer: queda registro aunque la lectura falle.
        const auditId = await audit.record({ actor: actorOf(principal), action: "reveal", target: id, reason, ip: clientIp(c, deps.trustProxy) })
        const payload = found(await revealer.reveal(id), "No existe la solicitud.")
        return PayloadReveal.parse({
          requestId: id,
          args: payload.args,
          purpose: payload.purpose ?? null,
          result: payload.result ?? null,
          auditId,
          revealedAt: new Date(now()).toISOString(),
        })
      }
      case "rewake": {
        const { id } = parseInput(adminRoutes.rewake.params, c.req.param())
        const { reason } = await parseBody(c, adminRoutes.rewake.body)
        return brokerAction(c, principal, "rewake", id, reason, () => broker.rewake(actor, id, reason))
      }
      case "expire": {
        const { id } = parseInput(adminRoutes.expire.params, c.req.param())
        const { reason } = await parseBody(c, adminRoutes.expire.body)
        return brokerAction(c, principal, "expire", id, reason, () => broker.expire(actor, id, reason))
      }
      case "revokeAgent": {
        const { userId, agentId } = parseInput(adminRoutes.revokeAgent.params, c.req.param())
        const { reason } = await parseBody(c, adminRoutes.revokeAgent.body)
        return brokerAction(c, principal, "revoke-agent", `${userId}/${agentId}`, reason, () => broker.revokeAgent(actor, userId, agentId, reason))
      }
      case "trace":
        return found(await queries.trace(parseInput(adminRoutes.trace.params, c.req.param()).id), "No existe la traza.")
      case "events":
        return { items: await queries.events(parseInput(adminRoutes.events.query, queryInput(c))) }
      case "live":
      case "flowLive":
        throw new Error(`${name} se atiende como stream`)
      case "flowSnapshot":
        return queries.flowSnapshot()
      case "errors":
        return { items: await queries.errors(parseInput(adminRoutes.errors.query, queryInput(c))) }
      case "error":
        return found(await queries.error(parseInput(adminRoutes.error.params, c.req.param()).id), "No existe el error.")
      case "users":
        return queries.users(parseInput(adminRoutes.users.query, queryInput(c)))
      case "user":
        return found(await queries.user(parseInput(adminRoutes.user.params, c.req.param()).id), "No existe la persona.")
      case "agents":
        return { items: await queries.agents(parseInput(adminRoutes.agents.query, queryInput(c))) }
      case "wakeQueue":
        return { items: await queries.wakeQueue(parseInput(adminRoutes.wakeQueue.query, queryInput(c)).state) }
      case "sql": {
        const { sql } = await parseBody(c, adminRoutes.sql.body)
        await audit.record({ actor: actorOf(principal), action: "sql", target: null, ip: clientIp(c, deps.trustProxy), meta: { length: sql.length } })
        return queries.sql(sql)
      }
      case "audit":
        return queries.audit(parseInput(adminRoutes.audit.query, queryInput(c)).cursor)
      case "tokens":
        return { items: await tokens.list() }
      case "createToken": {
        const input = await parseBody(c, adminRoutes.createToken.body)
        const created = await tokens.create(input, principal.email)
        await audit.record({
          actor: actorOf(principal),
          action: "token.create",
          target: created.meta.id,
          ip: clientIp(c, deps.trustProxy),
          meta: { scopes: created.meta.scopes.join(" "), ttlDays: input.ttlDays },
        })
        return created
      }
      case "revokeToken": {
        const { id } = parseInput(adminRoutes.revokeToken.params, c.req.param())
        if (!(await tokens.revoke(id))) throw new AdminHttpError("not_found", "No existe el token o ya estaba revocado.")
        await audit.record({ actor: actorOf(principal), action: "token.revoke", target: id, ip: clientIp(c, deps.trustProxy) })
        return { ok: true }
      }
    }
  }

  for (const [name, route] of Object.entries(adminRoutes) as [AdminRouteName, Route][]) {
    api.on([route.method], [route.path], guarded(async (c) => {
      c.header("Cache-Control", "no-store")
      const principal = await authenticate(c)
      if (roleRank[principal.role] < roleRank[route.role]) {
        throw new AdminHttpError("forbidden", "Tu rol no permite esta acción.")
      }
      if (mutation(route.method)) requireSameOrigin(c, "body" in route)
      if ("fresh" in route && route.fresh && !isFresh(principal)) {
        throw new AdminHttpError("not_fresh", "Vuelve a iniciar sesión para confirmar esta acción.")
      }
      if (name === "live") {
        const filters = parseInput(adminRoutes.live.query, queryInput(c))
        return liveStream(c, queries, telemetry, liveSlots, { stream: "events", principalId: principal.id, filters, backlog: true }, deps.live)
      }
      if (name === "flowLive") return flowLive(c, principal)
      return c.json(route.response.parse(await handle(name, c, principal)))
    }))
  }

  // Dev login: sesión de dev@sideband.local como operator. Solo existe con ADMIN_DEV_AUTH=1, que
  // env.ts prohíbe en producción. GET le dice a la SPA si debe mostrar «Entrar como dev».
  if (deps.devAuth) {
    api.get("/api/admin/dev-login", async (c) => {
      c.header("Cache-Control", "no-store")
      return c.json({ enabled: true })
    })
    api.post("/api/admin/dev-login", guarded(async (c) => {
      c.header("Cache-Control", "no-store")
      requireSameOrigin(c, false)
      const blocked = limiters.login.consume(clientIp(c, deps.trustProxy) ?? "unknown")
      if (blocked) throw new AdminHttpError("rate_limited", "Demasiados intentos de inicio de sesión.", blocked)
      const { headers } = await auth.api.issueSession({ body: { email: DEV_EMAIL, name: "Dev" }, returnHeaders: true })
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true })
      return c.json({ ok: true })
    }))
  }

  api.all("/api/admin/*", guarded(async () => {
    throw new AdminHttpError("not_found", "No se encontró la ruta.")
  }))
  api.onError((error, c) => errorResponse(c, error, telemetry))
  return api
}

function found<T>(value: T | null, message: string): T {
  if (value === null) throw new AdminHttpError("not_found", message)
  return value
}

// Límite de inicio de sesión (10 por minuto por IP) para /api/auth/sign-in/*.
export function loginRateLimit(limiters: AdminLimiters, trustProxy: boolean, telemetry: Pick<Telemetry, "error" | "emit">) {
  return async (c: Context, next: () => Promise<void>) => {
    const blocked = limiters.login.consume(clientIp(c, trustProxy) ?? "unknown")
    if (blocked) {
      return errorResponse(c, new AdminHttpError("rate_limited", "Demasiados intentos de inicio de sesión.", blocked), telemetry)
    }
    await next()
  }
}
