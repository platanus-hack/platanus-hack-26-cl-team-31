import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createTelemetry, memorySink } from "@team-31/telemetry"
import { honoTelemetry } from "@team-31/telemetry/hono"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import {
  adminRoutes,
  type AgentRow,
  type ErrorGroup,
  type Overview,
  type RequestDetail,
  type RequestSummary,
  type ServiceHealth,
  type TelemetryEvent,
  type Trace,
  type UserDetail,
  type UserSummary,
  type WakeJobRow,
} from "../../shared/contract.js"
import { AdminQueryError, type AdminQueries } from "../../shared/queries.js"
import { mountAdminMcp } from "./index.js"
import type { AdminMcpDeps, TokenPrincipal } from "./types.js"
import type { AdminSchema } from "./schema.js"

// ---------- Fixtures válidas según el contrato ----------

const at = "2026-11-21T10:00:00.000Z"
const later = "2026-11-21T10:05:00.000Z"

const service: ServiceHealth = { service: "broker", instance: "broker-1:42", version: "0.1.0", lastSeenAt: at, state: "up" }
const workerDown: ServiceHealth = { service: "worker", instance: "worker-1:7", version: "0.1.0", lastSeenAt: at, state: "down" }

const errorGroup: ErrorGroup = {
  service: "broker",
  operation: "POST /v1/agent/reply",
  type: "TypeError",
  count: 3,
  firstAt: at,
  lastAt: later,
  sampleErrorId: "6f1c1d2e-0000-4000-8000-000000000001",
}

const overview: Overview = {
  window: "1h",
  generatedAt: later,
  services: [service, workerDown],
  requests: {
    total: 182,
    open: 4,
    stuck: 2,
    byStatus: {
      awaiting_agent: 3, awaiting_owner: 1, answered: 150, no_data: 10,
      declined: 8, denied: 5, expired: 4, delivery_failed: 1,
    },
    byTool: { availability: 100, profile: 82 },
    timeToFinalMs: { p50: 1200, p95: 9800 },
  },
  wakes: [{ kind: "standard_webhook", ok: 97, failed: 3, retried: 2, p95LatencyMs: 450 }],
  errors: { total: 3, top: [errorGroup] },
  rateLimited: 0,
  activeQuotaWindows: 0,
}

const requestSummary: RequestSummary = {
  id: "req_8f2a",
  tool: "availability",
  fromAddress: "ana@sideband",
  toAddress: "bob@sideband",
  status: "awaiting_agent",
  outcome: null,
  rule: "contacts",
  escalated: false,
  targetAgentId: "agent-bob",
  answeredByAgentId: null,
  wakeAttempts: 2,
  lastWakeOk: false,
  createdAt: at,
  expiresAt: later,
  closedAt: null,
  durationMs: null,
  stuck: true,
}

const wakeJob: WakeJobRow = {
  id: "wj_1", requestId: "req_8f2a", attempt: 2, state: "done", runAt: at,
  kind: "standard_webhook", ok: false, httpStatus: 502, code: "bad_gateway",
}

const requestDetail: RequestDetail = {
  summary: requestSummary,
  allowedFields: ["slots"],
  droppedFields: [],
  decisionReason: "contacts",
  internalReason: null,
  argsKeys: ["range"],
  resultKeys: [],
  hasPurpose: true,
  responseSigned: false,
  timeline: [{
    at, source: "request_event", kind: "lifecycle", name: "created", service: "broker",
    status: "awaiting_agent", level: "info", durationMs: null, traceId: "a".repeat(32), errorId: null, attrs: { tool: "availability" },
  }],
  wakes: [wakeJob],
  traceIds: ["a".repeat(32)],
}

const trace: Trace = {
  traceId: "a".repeat(32),
  spans: [
    { spanId: "s1", parentSpanId: null, service: "mcp", name: "http.request", startAt: at, durationMs: 120, status: "200", level: "info", requestId: "req_8f2a", errorId: null, attrs: {} },
    { spanId: "s2", parentSpanId: "s1", service: "broker", name: "wake.attempt", startAt: at, durationMs: 80, status: "502", level: "error", requestId: "req_8f2a", errorId: errorGroup.sampleErrorId, attrs: { httpStatus: 502 } },
  ],
}

const event: TelemetryEvent = {
  id: "1042", at, service: "broker", kind: "error", name: "error", level: "error",
  traceId: "a".repeat(32), spanId: "s2", parentSpanId: "s1", requestId: "req_8f2a", userId: "u_bob", agentId: null,
  durationMs: null, status: null, errorId: errorGroup.sampleErrorId, attrs: { operation: "POST /v1/agent/reply", type: "TypeError" },
}

const agent: AgentRow = {
  userId: "u_bob", agentId: "agent-bob", label: "Claude de Bob", wakeKind: "standard_webhook", wakeHost: "hooks.example.test",
  verifiedAt: at, lastWakeAt: later, revokedAt: null, createdAt: at, wakes24h: { ok: 10, failed: 2 },
}

const userSummary: UserSummary = {
  userId: "u_bob", address: "bob@sideband", displayName: "Bob", createdAt: at, agents: 1, sent24h: 2, received24h: 5, lastActivityAt: later,
}

const userDetail: UserDetail = {
  summary: userSummary,
  identity: { email: "bob@example.test", activeSessions: 1, oauthClients: [{ clientId: "c1", name: "Claude", lastTokenAt: at, activeTokens: 1 }] },
  rules: { availability: "contacts" },
  agents: [agent],
  recentRequests: [requestSummary],
}

function fakeQueries(): AdminQueries {
  return {
    overview: vi.fn(async () => overview),
    services: vi.fn(async () => [service, workerDown]),
    requests: vi.fn(async () => ({ items: [requestSummary], nextCursor: "cur_2" })),
    request: vi.fn(async (id: string) => (id === requestSummary.id ? requestDetail : null)),
    trace: vi.fn(async (id: string) => (id === trace.traceId ? trace : null)),
    events: vi.fn(async () => [event]),
    errors: vi.fn(async () => [errorGroup]),
    error: vi.fn(async (id: string) => (id === event.errorId ? event : null)),
    users: vi.fn(async () => ({ items: [userSummary], nextCursor: null })),
    user: vi.fn(async (id: string) => (id === "u_bob" || id === "bob@sideband" ? userDetail : null)),
    agents: vi.fn(async () => [agent]),
    wakeQueue: vi.fn(async () => [wakeJob]),
    audit: vi.fn(async () => ({ items: [], nextCursor: null })),
    sql: vi.fn(async () => ({ columns: ["id", "status"], rows: [["req_8f2a", "awaiting_agent"]], truncated: false, durationMs: 12 })),
  }
}

// ---------- Harness: app Hono en memoria + cliente MCP del SDK ----------

const tokens: Record<string, TokenPrincipal> = {
  sba_read: { tokenId: "tok_read", label: "lectura", createdBy: "ops@sideband.test", scopes: ["admin:read"] },
  sba_sql: { tokenId: "tok_sql", label: "sql", createdBy: "ops@sideband.test", scopes: ["admin:read", "admin:sql"] },
  sba_other: { tokenId: "tok_other", label: "otro", createdBy: "ops@sideband.test", scopes: ["admin:read"] },
}

function setup(queries: AdminQueries = fakeQueries()) {
  const deps = {
    queries,
    authenticate: vi.fn(async (bearer: string) => tokens[bearer] ?? null),
    audit: vi.fn(async () => {}),
  } satisfies AdminMcpDeps
  const app = new Hono()
  const sink = memorySink()
  const telemetry = createTelemetry({ service: "admin", sink, lifecycle: false })
  app.use(honoTelemetry(telemetry))
  mountAdminMcp(app, deps, telemetry, "http://admin.test")
  return { app, deps, queries, sink }
}

const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

async function connect(app: Hono, token = "sba_read") {
  const client = new Client({ name: "admin-test", version: "1.0.0" })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL("http://admin.test/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => app.request(String(url), init),
  }))
  return client
}

function rpc(app: Hono, headers: Record<string, string>, method = "POST") {
  return app.request("http://admin.test/mcp", {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) : undefined,
  })
}

const textOf = (result: CallToolResult) =>
  result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

const toolNames = [
  "admin_overview", "admin_services", "admin_search_requests", "admin_get_request", "admin_get_trace",
  "admin_events", "admin_errors", "admin_get_error", "admin_search_users", "admin_get_user",
  "admin_agents", "admin_wake_queue", "admin_sql",
]

// ---------- Pruebas ----------

describe("descubrimiento", () => {
  it("lista exactamente las tools de la sección 6, de solo lectura y con outputSchema", async () => {
    const client = await connect(setup().app)
    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual([...toolNames].sort())
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
      expect(tool.outputSchema?.type).toBe("object")
      expect(tool.description).toBeTruthy()
    }
    const search = tools.find((t) => t.name === "admin_events")
    expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["request_id", "user_id", "trace_id", "after_id", "before_id"]),
    )
  })

  it("publica las instrucciones del servidor", async () => {
    const client = await connect(setup().app)
    const instructions = client.getInstructions() ?? ""
    expect(instructions).toContain("admin_overview")
    expect(instructions).toMatch(/redactados/)
    expect(instructions).toMatch(/payloads/)
  })
})

describe("tools", () => {
  const cases: [name: string, args: Record<string, unknown>, schema: z.ZodType][] = [
    ["admin_overview", { window: "1h" }, adminRoutes.overview.response],
    ["admin_services", {}, adminRoutes.services.response],
    ["admin_search_requests", { stuck: true }, adminRoutes.requests.response],
    ["admin_get_request", { request_id: "req_8f2a" }, adminRoutes.request.response],
    ["admin_get_trace", { trace_id: "a".repeat(32) }, adminRoutes.trace.response],
    ["admin_events", { level: "error" }, adminRoutes.events.response],
    ["admin_errors", {}, adminRoutes.errors.response],
    ["admin_get_error", { error_id: errorGroup.sampleErrorId }, adminRoutes.error.response],
    ["admin_search_users", { q: "bob" }, adminRoutes.users.response],
    ["admin_get_user", { id_or_address: "bob@sideband" }, adminRoutes.user.response],
    ["admin_agents", { failing: true }, adminRoutes.agents.response],
    ["admin_wake_queue", { state: "done" }, adminRoutes.wakeQueue.response],
    ["admin_sql", { sql: "select id, status from ops.v_requests" }, adminRoutes.sql.response],
  ]

  it.each(cases)("%s devuelve structuredContent que pasa su esquema y un resumen", async (name, args, schema) => {
    const client = await connect(setup().app, "sba_sql")
    const result = await client.callTool({ name, arguments: args }) as CallToolResult

    expect(result.isError).toBeFalsy()
    expect(schema.safeParse(result.structuredContent).success).toBe(true)
    const [summary, json] = result.content
    expect(summary).toMatchObject({ type: "text" })
    expect(summary?.type === "text" && summary.text.length).toBeGreaterThan(10)
    expect(json?.type === "text" && JSON.parse(json.text)).toEqual(result.structuredContent)
  })

  it("los resúmenes dan el siguiente paso", async () => {
    const client = await connect(setup().app)
    const overviewResult = await client.callTool({ name: "admin_overview", arguments: {} }) as CallToolResult
    expect(textOf(overviewResult)).toContain("2 atascadas")
    expect(textOf(overviewResult)).toContain("worker@worker-1:7 (down)")

    const search = await client.callTool({ name: "admin_search_requests", arguments: { stuck: true } }) as CallToolResult
    expect(textOf(search)).toContain("la más vieja req_8f2a")
    expect(textOf(search)).toContain('cursor="cur_2"')
  })

  it("mapea los argumentos snake_case a los filtros del contrato con sus valores por defecto", async () => {
    const { app, queries } = setup()
    const client = await connect(app)

    await client.callTool({ name: "admin_events", arguments: { request_id: "req_8f2a", trace_id: "t1", before_id: "99" } })
    expect(queries.events).toHaveBeenCalledWith({ requestId: "req_8f2a", traceId: "t1", beforeId: "99", limit: 100 })

    await client.callTool({ name: "admin_search_requests", arguments: { status: ["expired"], address: "bob@sideband" } })
    expect(queries.requests).toHaveBeenCalledWith({ status: ["expired"], address: "bob@sideband", limit: 50 })

    await client.callTool({ name: "admin_errors", arguments: { service: "broker" } })
    expect(queries.errors).toHaveBeenCalledWith({ window: "24h", service: "broker" })

    await client.callTool({ name: "admin_overview", arguments: {} })
    expect(queries.overview).toHaveBeenCalledWith("1h")
  })

  it("rechaza entradas fuera del esquema sin llegar a las consultas", async () => {
    const { app, queries } = setup()
    const client = await connect(app)
    const result = await client.callTool({ name: "admin_overview", arguments: { window: "1y" } }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(queries.overview).not.toHaveBeenCalled()
  })

  it("descarta campos que no están en el contrato", async () => {
    const queries = fakeQueries()
    vi.mocked(queries.request).mockResolvedValue({ ...requestDetail, args: { secreto: "x" } } as RequestDetail)
    const client = await connect(setup(queries).app)
    const result = await client.callTool({ name: "admin_get_request", arguments: { request_id: "req_8f2a" } }) as CallToolResult
    expect(result.structuredContent).not.toHaveProperty("args")
    expect(textOf(result)).not.toContain("secreto")
  })

  it.each([
    ["admin_get_request", { request_id: "req_nope" }, /No existe la solicitud «req_nope»/],
    ["admin_get_trace", { trace_id: "nope" }, /No existe la traza/],
    ["admin_get_error", { error_id: "nope" }, /No existe el error/],
    ["admin_get_user", { id_or_address: "nadie@sideband" }, /No existe la persona/],
  ])("%s sin resultado devuelve isError con un mensaje claro", async (name, args, message) => {
    const client = await connect(setup().app)
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(textOf(result)).toMatch(message)
  })

  it("traduce AdminQueryError y errores inesperados sin filtrar detalles", async () => {
    const queries = fakeQueries()
    vi.mocked(queries.sql).mockRejectedValueOnce(new AdminQueryError("invalid_input", "Solo se permite SELECT."))
    vi.mocked(queries.sql).mockRejectedValueOnce(new AdminQueryError("timeout", "canceling statement"))
    vi.mocked(queries.overview).mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:5432"))
    const client = await connect(setup(queries).app, "sba_sql")

    const invalid = await client.callTool({ name: "admin_sql", arguments: { sql: "delete from ops.events" } }) as CallToolResult
    expect(invalid.isError).toBe(true)
    expect(textOf(invalid)).toContain("Solo se permite SELECT.")

    const timeout = await client.callTool({ name: "admin_sql", arguments: { sql: "select pg_sleep(10)" } }) as CallToolResult
    expect(textOf(timeout)).toContain("3 s")

    const internal = await client.callTool({ name: "admin_overview", arguments: {} }) as CallToolResult
    expect(internal.isError).toBe(true)
    expect(textOf(internal)).not.toContain("ECONNREFUSED")
  })

  it("correlaciona las respuestas inválidas del servidor con la telemetría", async () => {
    const queries = fakeQueries()
    vi.mocked(queries.services).mockResolvedValueOnce([{ ...service, state: "invalid" as never }])
    const { app, sink } = setup(queries)
    const client = await connect(app)

    const result = await client.callTool({ name: "admin_services", arguments: {} }) as CallToolResult
    const [event] = sink.find("error")

    expect(event).toMatchObject({
      service: "admin", attrs: { operation: "admin.mcp.output" }, errorId: expect.any(String),
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(textOf(result)).toContain(`La consulta devolvió una respuesta inválida. Referencia: ${event?.errorId}.`)
  })
})

describe("autenticación y límites", () => {
  it("rechaza un origen ajeno antes de consultar tokens y exige autenticación en el propio", async () => {
    const { app, deps } = setup()
    const response = await rpc(app, { Origin: "https://otro.test", Authorization: "Bearer sba_read" })
    expect(response.status).toBe(403)
    expect(deps.authenticate).not.toHaveBeenCalled()
    expect((await rpc(app, { Origin: "http://admin.test" })).status).toBe(401)
  })
  it("sin token responde 401 con WWW-Authenticate: Bearer", async () => {
    const { app, deps } = setup()
    const response = await rpc(app, {})
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/)
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { message: expect.any(String) } })
    expect(deps.authenticate).not.toHaveBeenCalled()
  })

  it("con token inválido responde 401 y no consulta nada", async () => {
    const { app, deps, queries } = setup()
    const response = await rpc(app, { Authorization: "Bearer sba_revocado" })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"')
    expect(deps.authenticate).toHaveBeenCalledWith("sba_revocado")
    expect(queries.overview).not.toHaveBeenCalled()

    // Un bearer que no es sba_ (por ejemplo, un JWT de Sideband) ni siquiera llega a authenticate.
    const jwt = await rpc(app, { Authorization: "Bearer eyJhbGciOi.x.y" })
    expect(jwt.status).toBe(401)
    expect(deps.authenticate).toHaveBeenCalledTimes(1)
  })

  it("el cliente del SDK falla al conectar con un token inválido", async () => {
    await expect(connect(setup().app, "sba_revocado")).rejects.toThrow()
  })

  it("otros métodos responden 405 JSON-RPC", async () => {
    const { app } = setup()
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await rpc(app, { Authorization: "Bearer sba_read" }, method)
      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("POST")
      expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32000 } })
    }
  })

  it("admin_sql sin el scope admin:sql falla y no ejecuta la consulta", async () => {
    const { app, queries } = setup()
    const client = await connect(app, "sba_read")
    const result = await client.callTool({ name: "admin_sql", arguments: { sql: "select 1" } }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("admin:sql")
    expect(queries.sql).not.toHaveBeenCalled()
  })

  it("limita a 60 solicitudes por minuto por token", async () => {
    const { app } = setup()
    for (let i = 0; i < 60; i++) {
      const response = await rpc(app, { Authorization: "Bearer sba_read" })
      expect(response.status).toBe(200)
    }
    const limited = await rpc(app, { Authorization: "Bearer sba_read" })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(await limited.json()).toMatchObject({ jsonrpc: "2.0", error: { message: expect.stringContaining("60") } })

    // El límite es por token: otro token sigue funcionando.
    expect((await rpc(app, { Authorization: "Bearer sba_other" })).status).toBe(200)
  })

  it("la ventana del límite se renueva al pasar el minuto", async () => {
    vi.useFakeTimers({ now: new Date(at), toFake: ["Date"] })
    try {
      const { app } = setup()
      for (let i = 0; i < 60; i++) await rpc(app, { Authorization: "Bearer sba_read" })
      expect((await rpc(app, { Authorization: "Bearer sba_read" })).status).toBe(429)
      vi.setSystemTime(Date.parse(at) + 60_000)
      expect((await rpc(app, { Authorization: "Bearer sba_read" })).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("auditoría", () => {
  it("audita cada tools/call con mcp:<tool>, el actor y el target", async () => {
    const { app, deps } = setup()
    const client = await connect(app, "sba_read")
    await client.callTool({ name: "admin_get_request", arguments: { request_id: "req_8f2a" } })
    await client.callTool({ name: "admin_overview", arguments: {} })
    await client.callTool({ name: "admin_sql", arguments: { sql: "select 1" } })

    expect(deps.audit).toHaveBeenCalledTimes(3)
    expect(deps.audit).toHaveBeenNthCalledWith(1, { actor: tokens.sba_read, action: "mcp:admin_get_request", target: "req_8f2a" })
    expect(deps.audit).toHaveBeenNthCalledWith(2, { actor: tokens.sba_read, action: "mcp:admin_overview", target: null })
    // También queda auditado el intento sin scope.
    expect(deps.audit).toHaveBeenNthCalledWith(3, { actor: tokens.sba_read, action: "mcp:admin_sql", target: null })
  })

  it("no audita tools/list y falla cerrado si la auditoría no se puede escribir", async () => {
    const { app, deps, queries } = setup()
    const client = await connect(app)
    await client.listTools()
    expect(deps.audit).not.toHaveBeenCalled()

    deps.audit.mockRejectedValueOnce(new Error("db down"))
    const result = await client.callTool({ name: "admin_overview", arguments: {} }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("auditoría")
    expect(queries.overview).not.toHaveBeenCalled()
  })
})

describe("recurso admin://schema", () => {
  async function readSchema(queries: AdminQueries) {
    const client = await connect(setup(queries).app)
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(["admin://schema"])
    const { contents } = await client.readResource({ uri: "admin://schema" })
    const first = contents[0]
    if (!first || !("text" in first)) throw new Error("El recurso no devolvió texto.")
    return JSON.parse(first.text) as AdminSchema
  }

  it("usa information_schema vía AdminQueries.sql y oculta v_request_payloads", async () => {
    const queries = fakeQueries()
    vi.mocked(queries.sql).mockResolvedValue({
      columns: ["table_name", "column_name", "data_type"],
      rows: [
        ["v_events", "id", "bigint"],
        ["v_events", "name", "text"],
        ["v_request_payloads", "args", "jsonb"],
        ["v_requests", "id", "text"],
      ],
      truncated: false,
      durationMs: 3,
    })
    const schema = await readSchema(queries)

    expect(vi.mocked(queries.sql).mock.calls[0]?.[0]).toContain("information_schema.columns")
    expect(schema.source).toBe("information_schema")
    expect(schema.views).toEqual([
      { name: "ops.v_events", columns: [{ name: "id", type: "bigint" }, { name: "name", type: "text" }] },
      { name: "ops.v_requests", columns: [{ name: "id", type: "text" }] },
    ])
    expect(schema.events.map((e) => e.name)).toEqual(expect.arrayContaining(["broker.request.created", "wake.attempt", "admin.mcp.call"]))
  })

  it("si information_schema falla devuelve la lista estática de docs/admin.md", async () => {
    const queries = fakeQueries()
    vi.mocked(queries.sql).mockRejectedValue(new AdminQueryError("invalid_input", "no permitido"))
    const schema = await readSchema(queries)

    expect(schema.source).toBe("static")
    expect(schema.views.map((v) => v.name)).toEqual(expect.arrayContaining(["ops.v_requests", "ops.v_events", "ops.v_errors"]))
    expect(schema.views.map((v) => v.name)).not.toContain("ops.v_request_payloads")
    expect(schema.events.find((e) => e.name === "mcp.tool.call")).toEqual({ name: "mcp.tool.call", kind: "tool", attrs: ["tool", "outcome"] })
  })
})
