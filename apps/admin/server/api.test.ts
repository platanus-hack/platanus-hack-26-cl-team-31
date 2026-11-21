import { generateKeyPairSync } from "node:crypto"
import { verifyServiceToken } from "@team-31/auth/service"
import { createTelemetry, memorySink } from "@team-31/telemetry"
import { jwtVerify, type JWK } from "jose"
import type pg from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { AdminQueryError } from "../shared/queries.js"
import { createAdminApp } from "./app.js"
import { createPgAuditLog, migrateAdminTables } from "./audit.js"
import { createAdminAuth, createRoleResolver, migrateAdminAuth, type AdminAuthOptions } from "./auth/index.js"
import { createBrokerAdminClient } from "./broker.js"
import { createAdminPool } from "./db.js"
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

  function buildApp(overrides: { devAuth?: boolean } = {}) {
    const telemetry = createTelemetry({ service: "admin", sink, heartbeatMs: 0, lifecycle: false })
    const tokens = createPgTokenStore(pool)
    return createAdminApp({
      telemetry,
      auth,
      roleOf,
      queries,
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
      live: { pollMs: 20, heartbeatMs: 1_000 },
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
    pool = createAdminPool(TEST_DATABASE_URL!)
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

  it("devuelve la sesión con rol y frescura y respeta la cookie nexo-admin", async () => {
    const cookie = await login("viewer@test.cl")
    expect(cookie).toMatch(/^nexo-admin\.session_token=/)
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

  it("crea, lista y revoca tokens nxa_; el token revocado ya no autentica", async () => {
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

  it("/mcp acepta tokens nxa_ vigentes, audita cada tool y rechaza los revocados", async () => {
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
    expect(session.user).toMatchObject({ email: "dev@nexo.local", role: "operator" })
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
})
