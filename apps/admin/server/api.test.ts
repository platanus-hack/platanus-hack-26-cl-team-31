import { generateKeyPairSync } from "node:crypto"
import { verifyServiceToken } from "@team-31/auth/service"
import { createTelemetry, memorySink } from "@team-31/telemetry"
import { jwtVerify, type JWK } from "jose"
import { createTestDatabase, ignoreTerminationAfterEnd, type TestDatabase } from "@team-31/test-db"
import type pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { TelemetryEvent } from "../shared/contract.js"
import { AdminQueryError, type AdminQueries } from "../shared/queries.js"
import { createAdminApp } from "./app.js"
import { createPgAuditLog, migrateAdminTables } from "./audit.js"
import { createAdminAuth, createRoleResolver, migrateAdminAuth, type AdminAuthOptions } from "./auth/index.js"
import { createBrokerAdminClient } from "./broker.js"
import { createAdminPool } from "./db.js"
import type { LiveOptions } from "./live.js"
import { createAdminLimiters } from "./rate-limit.js"
import { fakeQueries, telemetryEvent, TEST_DATABASE_URL } from "./test-support.js"
import { createPgTokenStore } from "./tokens.js"

const ADMIN_URL = "http://127.0.0.1:4400"
const BROKER_URL = "http://broker.test"
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const privateJwk = privateKey.export({ format: "jwk" }) as JWK
const publicJwk = publicKey.export({ format: "jwk" }) as JWK

describe.skipIf(!TEST_DATABASE_URL)("API del admin (Postgres)", () => {
  let pool: pg.Pool
  let testDb: TestDatabase | undefined
  const allow = { operators: ["op@test.cl"], viewers: ["viewer@test.cl"] }
  const roleOf = createRoleResolver(() => allow, { devAuth: true })
  let authOptions: AdminAuthOptions
  let auth: ReturnType<typeof createAdminAuth>
  const brokerFetch = vi.fn<typeof fetch>()
  let sink = memorySink()
  const reveal = vi.fn()
  const queries = fakeQueries({
    sql: async (sql) => {
      if (!/^select/i.test(sql)) throw new AdminQueryError("invalid_input", "Solo SELECT.")
      return { columns: ["one"], rows: [[1]], truncated: false, durationMs: 1 }
    },
    events: async ({ afterId }) => (afterId ? [] : [telemetryEvent("2"), telemetryEvent("1")]),
  })

  function buildApp(overrides: { devAuth?: boolean; queries?: AdminQueries; live?: LiveOptions } = {}) {
    const telemetry = createTelemetry({ service: "admin", sink, heartbeatMs: 0, lifecycle: false })
    const tokens = createPgTokenStore(pool)
    return createAdminApp({
      telemetry,
      auth,
      roleOf,
      queries: overrides.queries ?? queries,
      tokens,
      authenticateToken: (bearer) => tokens.authenticate(bearer),
      audit: createPgAuditLog(pool, telemetry),
      broker: createBrokerAdminClient({ baseUrl: BROKER_URL, privateKey: privateJwk, fetch: brokerFetch }),
      revealer: { reveal },
      limiters: createAdminLimiters(),
      adminUrl: ADMIN_URL,
      freshSeconds: 600,
      devAuth: overrides.devAuth ?? false,
      trustProxy: false,
      serveSpa: false,
      live: { pollMs: 20, heartbeatMs: 1_000, ...overrides.live },
    })
  }

  async function login(email: string) {
    const { headers } = await auth.api.issueSession({ body: { email, name: email.split("@")[0]! }, returnHeaders: true })
    return headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")
  }

  const post = (cookie: string, body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { cookie, origin: ADMIN_URL, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

  const auditRows = async () =>
    (await pool.query("SELECT actor_type, actor_label, action, target, reason, meta FROM admin.audit ORDER BY at")).rows

  beforeAll(async () => {
    // Base propia: better-auth inspecciona todos los esquemas, y otros paquetes crean y borran
    // los suyos en app_test en paralelo.
    testDb = await createTestDatabase("admin_api")
    pool = ignoreTerminationAfterEnd(createAdminPool(testDb.url))
    authOptions = { pool, baseUrl: ADMIN_URL, secret: "x".repeat(32), roleOf, freshSeconds: 600 }
    await migrateAdminTables(pool)
    await migrateAdminAuth(authOptions)
    auth = createAdminAuth(authOptions)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM admin.audit; DELETE FROM admin.tokens; DELETE FROM admin.session; DELETE FROM admin.account; DELETE FROM admin."user"')
    allow.operators = ["op@test.cl"]
    allow.viewers = ["viewer@test.cl"]
    brokerFetch.mockReset()
    sink = memorySink()
    reveal.mockReset()
  })

  afterAll(async () => {
    await pool?.end()
    await testDb?.drop()
  })

  it("responde /healthz sin sesión", async () => {
    const response = await buildApp().request("/healthz")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: "admin" })
  })

  it("401 sin sesión, con no-store y ErrorBody", async () => {
    const app = buildApp()
    for (const path of ["/api/admin/session", "/api/admin/services", "/api/admin/requests/req_1"]) {
      const response = await app.request(path)
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect((await response.json()).error.code).toBe("unauthorized")
    }
  })

  it("devuelve la sesión con rol y frescura y respeta la cookie sideband-admin", async () => {
    const cookie = await login("viewer@test.cl")
    expect(cookie).toMatch(/^sideband-admin\.session_token=/)
    const response = await buildApp().request("/api/admin/session", { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toMatchObject({ email: "viewer@test.cl", role: "viewer" })
    expect(body.session.fresh).toBe(true)
  })

  it("no crea usuario ni sesión para correos fuera de la lista", async () => {
    await expect(login("intruso@test.cl")).rejects.toThrow()
    const { rowCount } = await pool.query('SELECT 1 FROM admin."user" WHERE email = $1', ["intruso@test.cl"])
    expect(rowCount).toBe(0)
  })

  it("recalcula el rol en cada request: quitar el correo da 403", async () => {
    const cookie = await login("viewer@test.cl")
    const app = buildApp()
    expect((await app.request("/api/admin/services", { headers: { cookie } })).status).toBe(200)
    allow.viewers = []
    const response = await app.request("/api/admin/services", { headers: { cookie } })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("forbidden")
  })

  it("403 por rol: un viewer no puede revelar, actuar ni gestionar tokens", async () => {
    const cookie = await login("viewer@test.cl")
    const app = buildApp()
    const attempts = [
      app.request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "depurando un caso real" })),
      app.request("/api/admin/requests/req_1/rewake", post(cookie, { reason: "depurando un caso real" })),
      app.request("/api/admin/sql", post(cookie, { sql: "select 1" })),
      app.request("/api/admin/tokens", { headers: { cookie } }),
    ]
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("forbidden")
    }
    expect(reveal).not.toHaveBeenCalled()
    expect(brokerFetch).not.toHaveBeenCalled()
  })

  it("exige Origin = ADMIN_URL y JSON en mutaciones", async () => {
    const cookie = await login("op@test.cl")
    const app = buildApp()
    const body = { reason: "depurando un caso real" }

    const missing = await app.request("/api/admin/requests/req_1/reveal", { ...post(cookie, body), headers: { cookie, "content-type": "application/json" } })
    expect(missing.status).toBe(403)
    const foreign = await app.request("/api/admin/requests/req_1/reveal", post(cookie, body, { origin: "https://evil.test" }))
    expect(foreign.status).toBe(403)
    expect((await foreign.json()).error.code).toBe("forbidden")
    const text = await app.request("/api/admin/requests/req_1/reveal", post(cookie, body, { "content-type": "text/plain" }))
    expect(text.status).toBe(400)
    expect((await text.json()).error.code).toBe("invalid_input")

    expect(reveal).not.toHaveBeenCalled()
  })

  it("not_fresh si la sesión tiene más de ADMIN_FRESH_SECONDS", async () => {
    const cookie = await login("op@test.cl")
    await pool.query(`UPDATE admin.session SET "createdAt" = now() - interval '1 hour'`)
    const app = buildApp()

    const response = await app.request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "depurando un caso real" }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("not_fresh")
    expect(reveal).not.toHaveBeenCalled()

    const session = await (await app.request("/api/admin/session", { headers: { cookie } })).json()
    expect(session.session.fresh).toBe(false)
    // Las lecturas siguen funcionando con sesión no fresca.
    expect((await app.request("/api/admin/services", { headers: { cookie } })).status).toBe(200)
  })

  it("revela el payload con auditoría previa y no-store", async () => {
    reveal.mockResolvedValue({ args: { day: "lunes" }, purpose: "agendar", result: { free: true } })
    const cookie = await login("op@test.cl")
    const response = await buildApp().request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "depurando un caso real" }))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json()
    expect(body).toMatchObject({ requestId: "req_1", args: { day: "lunes" }, purpose: "agendar", result: { free: true } })
    expect(reveal).toHaveBeenCalledWith("req_1")
    const rows = await auditRows()
    expect(rows.filter((row) => row.action === "reveal")).toEqual([
      { actor_type: "admin", actor_label: "op@test.cl", action: "reveal", target: "req_1", reason: "depurando un caso real", meta: {} },
    ])
    const { rows: [audit] } = await pool.query("SELECT id FROM admin.audit WHERE action = 'reveal'")
    expect(body.auditId).toBe(audit.id)
    // Cada fila de auditoría emite su evento admin.*, sin motivo ni payload.
    const [event] = sink.find("admin.reveal")
    expect(event).toMatchObject({ requestId: "req_1", attrs: { action: "reveal", target: "req_1" } })
    expect(JSON.stringify(sink.records)).not.toContain("depurando")
    expect(JSON.stringify(sink.records)).not.toContain("lunes")
  })

  it("exige un motivo de 10 a 500 caracteres y limita reveal a 10 por hora", async () => {
    reveal.mockResolvedValue({ args: {}, purpose: null, result: null })
    const cookie = await login("op@test.cl")
    const app = buildApp()
    expect((await app.request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "corto" }))).status).toBe(400)

    for (let i = 0; i < 10; i++) {
      expect((await app.request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "depurando un caso real" }))).status).toBe(200)
    }
    const limited = await app.request("/api/admin/requests/req_1/reveal", post(cookie, { reason: "depurando un caso real" }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/)
    expect((await limited.json()).error.code).toBe("rate_limited")
  })

  it("404 si la solicitud a revelar no existe (y queda auditado el intento)", async () => {
    reveal.mockResolvedValue(null)
    const cookie = await login("op@test.cl")
    const response = await buildApp().request("/api/admin/requests/nope/reveal", post(cookie, { reason: "depurando un caso real" }))
    expect(response.status).toBe(404)
    expect((await auditRows()).map((row) => row.action)).toContain("reveal")
  })

  it("rewake llama al broker con JWT iss=admin y audita el resultado", async () => {
    brokerFetch.mockResolvedValue(new Response(null, { status: 204 }))
    const cookie = await login("op@test.cl")
    const response = await buildApp().request("/api/admin/requests/req_1/rewake", post(cookie, { reason: "el aviso se perdió" }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)

    const [url, init] = brokerFetch.mock.calls[0]!
    expect(String(url)).toBe(`${BROKER_URL}/v1/admin/requests/req_1/rewake`)
    expect(init?.method).toBe("POST")
    expect(init?.redirect).toBe("error")
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "el aviso se perdió" })
    const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "")
    const { payload } = await jwtVerify(token, publicJwk, { issuer: "admin", audience: "broker", algorithms: ["EdDSA"] })
    const { rows: [user] } = await pool.query('SELECT id FROM admin."user" WHERE email = $1', ["op@test.cl"])
    expect(payload).toMatchObject({ sub: user.id, email: "op@test.cl" })
    expect(payload.exp! - payload.iat!).toBe(60)
    expect(payload.jti).toBeTypeOf("string")
    // El broker (ADM-03) lo acepta como AdminActor.
    await expect(verifyServiceToken(token, { publicKeys: { admin: publicJwk }, expectedIss: "admin" }))
      .resolves.toEqual({ adminId: user.id, email: "op@test.cl" })

    const rows = await auditRows()
    expect(rows.find((row) => row.action === "rewake")).toMatchObject({ target: "req_1", reason: "el aviso se perdió", meta: { ok: true } })
    expect(sink.find("admin.action")[0]).toMatchObject({ attrs: { action: "rewake", target: "req_1" } })
  })

  it("expire y revokeAgent: errores del broker se mapean y quedan auditados", async () => {
    brokerFetch.mockResolvedValueOnce(Response.json({ error: { code: "conflict", message: "cerrada" } }, { status: 409 }))
    brokerFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const cookie = await login("op@test.cl")
    const app = buildApp()

    const expire = await app.request("/api/admin/requests/req_1/expire", post(cookie, { reason: "atascada hace horas" }))
    expect(expire.status).toBe(400)
    expect((await expire.json()).error.code).toBe("invalid_input")

    const revoke = await app.request("/api/admin/agents/user%2F1/agent-1/revoke", post(cookie, { reason: "agente comprometido" }))
    expect(revoke.status).toBe(200)
    expect(String(brokerFetch.mock.calls[1]![0])).toBe(`${BROKER_URL}/v1/admin/agents/user%2F1/agent-1/revoke`)

    const rows = await auditRows()
    expect(rows.find((row) => row.action === "expire")).toMatchObject({ meta: { ok: false, code: "invalid_input" } })
    expect(rows.find((row) => row.action === "revoke-agent")).toMatchObject({ target: "user/1/agent-1", meta: { ok: true } })
  })

  it("mapea AdminQueryError y 404 de lecturas a ErrorBody", async () => {
    const cookie = await login("op@test.cl")
    const app = buildApp()
    const sql = await app.request("/api/admin/sql", post(cookie, { sql: "delete from ops.events" }))
    expect(sql.status).toBe(400)
    expect((await sql.json()).error.code).toBe("invalid_input")

    const missing = await app.request("/api/admin/requests/req_x", { headers: { cookie } })
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe("not_found")

    const unknown = await app.request("/api/admin/nada", { headers: { cookie } })
    expect(unknown.status).toBe(404)

    const invalid = await app.request("/api/admin/overview?window=3y", { headers: { cookie } })
    expect(invalid.status).toBe(400)
  })

  it("crea, lista y revoca tokens sba_; el token revocado ya no autentica", async () => {
    const cookie = await login("op@test.cl")
    const app = buildApp()
    const tokens = createPgTokenStore(pool)

    const created = await app.request("/api/admin/tokens", post(cookie, { name: "codex", ttlDays: 2, scopes: ["admin:read"] }))
    expect(created.status).toBe(200)
    const { token, meta } = await created.json()
    expect(meta.createdBy).toBe("op@test.cl")
    expect(await tokens.authenticate(token)).toMatchObject({ tokenId: meta.id })

    const list = await (await app.request("/api/admin/tokens", { headers: { cookie } })).json()
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([meta.id])
    expect(JSON.stringify(list)).not.toContain(token)

    const revoked = await app.request(`/api/admin/tokens/${meta.id}`, { method: "DELETE", headers: { cookie, origin: ADMIN_URL } })
    expect(revoked.status).toBe(200)
    expect(await tokens.authenticate(token)).toBeNull()
    expect((await app.request(`/api/admin/tokens/${meta.id}`, { method: "DELETE", headers: { cookie, origin: ADMIN_URL } })).status).toBe(404)

    expect((await auditRows()).map((row) => row.action)).toEqual(expect.arrayContaining(["token.create", "token.revoke"]))
  })

  it("/mcp acepta tokens sba_ vigentes, audita cada tool y rechaza los revocados", async () => {
    const app = buildApp()
    const tokens = createPgTokenStore(pool)
    const { token, meta } = await tokens.create({ name: "claude-test", ttlDays: 1 }, "op@test.cl")
    const call = (bearer: string) => app.request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "admin_services", arguments: {} } }),
    })

    const ok = await call(token)
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.result.structuredContent.items[0]).toMatchObject({ service: "broker", state: "up" })
    expect(await auditRows()).toEqual([
      { actor_type: "token", actor_label: "claude-test", action: "mcp:admin_services", target: null, reason: null, meta: {} },
    ])
    expect(sink.find("admin.mcp.call")[0]).toMatchObject({ attrs: { action: "mcp:admin_services", tool: "admin_services" } })

    await tokens.revoke(meta.id)
    const revoked = await call(token)
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get("www-authenticate")).toContain("Bearer")
    expect(sink.find("auth.token.rejected")[0]).toMatchObject({ attrs: { issuer: "admin", reason: "invalid_token" } })
  })

  it("dev login solo con ADMIN_DEV_AUTH=1 y Origin válido", async () => {
    expect((await buildApp().request("/api/admin/dev-login", { method: "POST", headers: { origin: ADMIN_URL } })).status).toBe(404)

    const app = buildApp({ devAuth: true })
    expect(await (await app.request("/api/admin/dev-login")).json()).toEqual({ enabled: true })
    expect((await app.request("/api/admin/dev-login", { method: "POST" })).status).toBe(403)

    const response = await app.request("/api/admin/dev-login", { method: "POST", headers: { origin: ADMIN_URL } })
    expect(response.status).toBe(200)
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
    const session = await (await app.request("/api/admin/session", { headers: { cookie } })).json()
    expect(session.user).toMatchObject({ email: "dev@sideband.local", role: "operator" })
  })

  it("SSE /live envía eventos en orden con id y event telemetry", async () => {
    const cookie = await login("viewer@test.cl")
    const controller = new AbortController()
    const response = await buildApp().request("/api/admin/live", { headers: { cookie }, signal: controller.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-store")

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ""
    while (!text.includes("id: 2")) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    controller.abort()
    await reader.cancel()
    expect(text).toMatch(/event: telemetry\ndata: .*\nid: 1[\s\S]*id: 2/)
  })

  describe("flujo en vivo", () => {
    // ops.events en memoria: el fake responde como createPgAdminQueries (cola ascendente con afterId).
    function eventTable(initial: TelemetryEvent[]) {
      const rows = [...initial]
      const seenFilters: { names?: readonly string[] }[] = []
      const flowQueries = fakeQueries({
        latestEventId: async () => (rows.length ? rows.map((row) => BigInt(row.id)).reduce((a, b) => (a > b ? a : b)).toString() : null),
        events: async (filters) => {
          seenFilters.push({ names: filters.names })
          const match = rows.filter((row) => !filters.names || filters.names.includes(row.name))
          const sorted = match.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
          if (filters.afterId) return sorted.filter((row) => BigInt(row.id) > BigInt(filters.afterId!)).slice(0, filters.limit)
          return sorted.reverse().slice(0, filters.limit)
        },
        requestRefs: async (ids) =>
          ids.filter((id) => id === "r1").map((id) => ({
            id, fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app", targetAgentId: "b1",
            answeredByAgentId: null, status: "awaiting_agent" as const, createdAt: "2026-01-01T00:00:00.000Z",
          })),
      })
      return { rows, seenFilters, queries: flowQueries }
    }
    const event = (id: string, name: string, fields: Partial<TelemetryEvent> = {}): TelemetryEvent => ({
      ...telemetryEvent(id), name, requestId: "r1", attrs: {}, ...fields,
    })

    async function readUntil(response: Response, done: (text: string) => boolean, controller: AbortController) {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let text = ""
      const deadline = Date.now() + 3_000
      while (!done(text) && Date.now() < deadline) {
        const { value, done: ended } = await reader.read()
        if (ended) break
        text += decoder.decode(value)
      }
      controller.abort()
      await reader.cancel().catch(() => undefined)
      return text
    }
    const messages = (text: string) =>
      text.split("\n\n").filter((block) => block.includes("data:")).map((block) => ({
        event: /event: (.*)/.exec(block)?.[1],
        id: /id: (.*)/.exec(block)?.[1],
        data: JSON.parse(/data: (.*)/.exec(block)![1]!) as Record<string, unknown>,
      }))

    it("exige sesión y rol: 401 sin sesión, 403 sin acceso, viewer sí", async () => {
      const app = buildApp()
      expect((await app.request("/api/admin/flow/snapshot")).status).toBe(401)
      expect((await app.request("/api/admin/flow/live")).status).toBe(401)
      // Una sesión cuyo correo deja de estar en la lista de acceso.
      allow.viewers = ["viewer@test.cl", "ex@test.cl"]
      const outsider = await login("ex@test.cl")
      allow.viewers = ["viewer@test.cl"]
      expect((await app.request("/api/admin/flow/snapshot", { headers: { cookie: outsider } })).status).toBe(403)
      expect((await app.request("/api/admin/flow/live", { headers: { cookie: outsider } })).status).toBe(403)
      const viewer = await login("viewer@test.cl")
      const snapshot = await app.request("/api/admin/flow/snapshot", { headers: { cookie: viewer } })
      expect(snapshot.status).toBe(200)
      expect(await snapshot.json()).toMatchObject({ cursor: null, users: [], agents: [], requests: [] })
      expect((await app.request("/api/admin/flow/live?after=abc", { headers: { cookie: viewer } })).status).toBe(400)
    })

    it("filtra por nombre en el servidor, recorta attrs y manda el resumen de la solicitud antes de sus eventos", async () => {
      const table = eventTable([
        event("1", "http.request", { requestId: null, attrs: { route: "/mcp" } }),
        event("2", "broker.policy.evaluated", { attrs: { tool: "question", decision: "allow", category: "general", rule: "grant", args: "secreto", text: "privado" } }),
        event("3", "coordination.tool.call", { requestId: null, attrs: { tool: "meeting_propose", outcome: "ok" } }),
        event("4", "mcp.tool.call", { attrs: { tool: "sideband_ask", outcome: "ok" } }),
      ])
      const cookie = await login("viewer@test.cl")
      const controller = new AbortController()
      const response = await buildApp({ queries: table.queries }).request("/api/admin/flow/live?after=0", { headers: { cookie }, signal: controller.signal })
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      const sent = messages(await readUntil(response, (text) => text.includes("id: 4"), controller))

      expect(sent.map((m) => `${m.event}:${m.id ?? ""}`)).toEqual(["request:", "telemetry:2", "telemetry:4"])
      expect(sent[0]!.data).toMatchObject({ id: "r1", fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app" })
      expect(sent[1]!.data.attrs).toEqual({ tool: "question", decision: "allow", category: "general", rule: "grant" })
      expect(JSON.stringify(sent)).not.toMatch(/secreto|privado|meeting_propose/)
      // El filtro por nombre va a la consulta: http.request ni siquiera se lee.
      expect(table.seenFilters[0]!.names).toContain("broker.policy.evaluated")
      expect(table.seenFilters[0]!.names).not.toContain("http.request")
    })

    it.each(["sesión", "rol"])("cierra el stream antes de entregar el siguiente lote al perder %s", async (cause) => {
      const cookie = await login("viewer@test.cl")
      const table = eventTable([])
      const app = buildApp({ queries: table.queries })
      const path = cause === "sesión" ? "/api/admin/live" : "/api/admin/flow/live"
      const controller = new AbortController()
      try {
        const response = await app.request(path, { headers: { cookie }, signal: controller.signal })
        expect(response.status).toBe(200)
        if (cause === "sesión") await auth.api.signOut({ headers: new Headers({ cookie }) })
        else allow.viewers = []
        table.rows.push(event("1", "broker.request.created"))
        expect(await response.text()).not.toContain("event: telemetry")
        expect(sink.find("admin.live.closed")[0]?.attrs).toMatchObject({ reason: "access_ended", delivered: 0 })
      } finally {
        controller.abort()
      }
    })

    it("entrega una escritura que confirmó tarde (id menor) una sola vez", async () => {
      const table = eventTable([event("10", "broker.request.created"), event("12", "broker.request.closed")])
      const cookie = await login("viewer@test.cl")
      const controller = new AbortController()
      const response = await buildApp({ queries: table.queries }).request("/api/admin/flow/live?after=9", { headers: { cookie }, signal: controller.signal })
      setTimeout(() => table.rows.push(event("11", "broker.request.status_changed", { attrs: { from: "awaiting_agent", to: "answered", by: "agent" } })), 80)
      const text = await readUntil(response, (value) => value.includes("id: 11"), controller)
      const ids = messages(text).filter((m) => m.event === "telemetry").map((m) => m.id)
      expect(ids).toEqual(["10", "12", "11"])
    })

    it("Last-Event-ID gana sobre after y un hueco demasiado grande manda reset", async () => {
      const table = eventTable([event("5", "broker.request.created"), event("6", "broker.request.closed"), event("100", "broker.request.created")])
      const cookie = await login("viewer@test.cl")
      let controller = new AbortController()
      let response = await buildApp({ queries: table.queries }).request("/api/admin/flow/live?after=0", { headers: { cookie, "last-event-id": "5" }, signal: controller.signal })
      let sent = messages(await readUntil(response, (text) => text.includes("id: 100"), controller))
      expect(sent.filter((m) => m.event === "telemetry").map((m) => m.id)).toEqual(["6", "100"])

      controller = new AbortController()
      response = await buildApp({ queries: table.queries, live: { maxCatchUp: 50 } }).request("/api/admin/flow/live?after=5", { headers: { cookie }, signal: controller.signal })
      sent = messages(await readUntil(response, (text) => text.includes("event: reset"), controller))
      expect(sent[0]).toEqual({ event: "reset", id: "100", data: { cursor: "100" } })
    })

    it("un admin que se está apagando rechaza streams nuevos con Connection: close", async () => {
      const cookie = await login("viewer@test.cl")
      const response = await buildApp({ live: { shutdown: AbortSignal.abort() } }).request("/api/admin/flow/live", { headers: { cookie } })
      expect(response.status).toBe(502)
      expect(response.headers.get("connection")).toBe("close")
      expect((await response.json()).error.code).toBe("upstream")
    })

    it("reserva un cupo durante la primera lectura y lo devuelve si esa lectura falla", async () => {
      const cookie = await login("viewer@test.cl")
      let started!: () => void
      let fail!: (error: Error) => void
      const reading = new Promise<void>((resolve) => { started = resolve })
      const page = new Promise<null>((_, reject) => { fail = reject })
      const latestEventId = vi.fn(async (): Promise<string | null> => null)
        .mockImplementationOnce(() => { started(); return page })
      const app = buildApp({ queries: fakeQueries({ latestEventId }), live: { maxStreams: 1 } })
      const options = { headers: { cookie } }
      const first = app.request("/api/admin/live", options)
      await reading
      try {
        expect((await app.request("/api/admin/flow/live", options)).status).toBe(429)
        expect(latestEventId).toHaveBeenCalledTimes(1)
      } finally {
        fail(new Error("lectura interrumpida"))
      }
      expect((await first).status).toBe(500)
      const controller = new AbortController()
      const retry = await app.request("/api/admin/live", { ...options, signal: controller.signal })
      controller.abort()
      expect(retry.status).toBe(200)
    })

    it("limita las conexiones por admin y registra apertura y cierre", async () => {
      const table = eventTable([event("1", "broker.request.created")])
      const cookie = await login("viewer@test.cl")
      const app = buildApp({ queries: table.queries, live: { maxStreams: 1 } })
      const controller = new AbortController()
      const first = await app.request("/api/admin/flow/live?after=0", { headers: { cookie }, signal: controller.signal })
      expect(first.status).toBe(200)
      const second = await app.request("/api/admin/flow/live?after=0", { headers: { cookie } })
      expect(second.status).toBe(429)
      expect((await second.json()).error.code).toBe("rate_limited")
      await readUntil(first, (text) => text.includes("id: 1"), controller)

      const deadline = Date.now() + 2_000
      while (sink.find("admin.live.closed").length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
      expect(sink.find("admin.live.opened")).toEqual([expect.objectContaining({ attrs: { stream: "flow", resumed: true, reset: false } })])
      expect(sink.find("admin.live.closed")).toEqual([expect.objectContaining({ attrs: expect.objectContaining({ stream: "flow", reason: "client", delivered: 1 }) })])
      // Cerrada la primera, se puede volver a abrir.
      const again = new AbortController()
      const third = await app.request("/api/admin/flow/live?after=0", { headers: { cookie }, signal: again.signal })
      expect(third.status).toBe(200)
      again.abort()
    })
  })
})
