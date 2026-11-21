// Pruebas de createPgAdminQueries y createPgRevealer contra Postgres (TEST_DATABASE_URL).
// Cada corrida usa una base aislada: migra broker, Better Auth, coordinación y ops, siembra con el
// Store del broker y verifica que cada método cumpla el contrato y no filtre payloads.
import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"

import { migrateAuth } from "@team-31/auth/server"
import {
  applyPostgresMigrations,
  createPostgresStore,
  type PostgresStore,
} from "@team-31/broker/postgres"
import { applyOpsMigrations } from "@team-31/ops"
import { createTestDatabase, type TestDatabase } from "@team-31/test-db"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  AgentRow,
  AuditEntry,
  ErrorFilters,
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
  UserFilters,
  UserSummary,
  WakeJobRow,
} from "../../shared/contract.js"
import { AdminQueryError } from "../../shared/queries.js"
import { migrateAdminTables } from "../audit.js"
import {
  createPgAdminQueries,
  createPgRevealer,
  type PgAdminQueries,
  type PgRevealer,
} from "./index.js"

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? ""
const secretsKey = Buffer.alloc(32, 7).toString("base64")
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

// Valores privados sembrados: ninguno puede aparecer en las lecturas redactadas.
const SECRET_QUESTION = "pregunta-privada-de-alice"
const SECRET_PURPOSE = "proposito-privado"
const SECRET_ANSWER = "respuesta-privada-de-bruno"
const WAKE_SECRET = "whsec_c2VjcmV0by1kZS1hdmlzbw=="
const SESSION_TOKEN = "session-token-secreto"
const ACCESS_TOKEN = "access-token-secreto"

const NOW = Date.now()
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000)

async function expectInvalid(
  promise: Promise<unknown>,
  code: AdminQueryError["code"] = "invalid_input"
) {
  await expect(promise).rejects.toBeInstanceOf(AdminQueryError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe.skipIf(!testDatabaseUrl)("createPgAdminQueries", () => {
  let testDb: TestDatabase
  let db: pg.Pool
  let databaseUrl: string
  let store: PostgresStore
  let queries: PgAdminQueries
  let revealer: PgRevealer
  const ids = {
    open: "req_open_1",
    answered: "req_answered_1",
    stuck: "req_stuck_1",
  }
  const errorId = randomUUID()
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736"

  beforeAll(async () => {
    testDb = await createTestDatabase("admin_queries_test")
    databaseUrl = testDb.url
    db = testDb.pool()

    // Tablas de cada módulo, como en producción. ops migra al final.
    await applyPostgresMigrations({ databaseUrl })
    await migrateAuth({
      databaseUrl,
      baseUrl: "http://127.0.0.1:3999",
      secret: "secreto-de-prueba-de-better-auth-0123456789",
      mcpResource: "http://127.0.0.1:4199/mcp",
    })
    const coordination = new URL("../../../server/sql/", import.meta.url)
    for (const file of (await readdir(coordination))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await db.query(await readFile(new URL(file, coordination), "utf8"))
    }
    // Tablas del servidor admin (ADM-04). ops migra después y otorga SELECT en admin.audit.
    await migrateAdminTables(db)
    await applyOpsMigrations({ databaseUrl })

    store = createPostgresStore({ databaseUrl, secretsKey })
    await seed()
    queries = createPgAdminQueries({ databaseUrl })
    revealer = createPgRevealer({ databaseUrl })
  }, 60_000)

  afterAll(async () => {
    try {
      await queries?.close()
      await revealer?.close()
      await store?.close()
    } finally {
      await testDb?.drop()
    }
  })

  async function seed() {
    const base = {
      fromUserId: "alice",
      toUserId: "bruno",
      fromAddress: "alice@sideband.app" as const,
      toAddress: "bruno@sideband.app" as const,
      tool: "question" as const,
      args: { text: SECRET_QUESTION },
      purpose: SECRET_PURPOSE,
      allowedFields: ["answer"],
      guidance: "",
      rule: "circle:friends",
      escalated: false,
      envelopeSignature: "firma-del-sobre",
      targetAgentId: "main",
      version: 0,
    }
    await store.tx(async (tx) => {
      await tx.createAddress("alice", "alice@sideband.app")
      await tx.createAddress("bruno", "bruno@sideband.app")
      await tx.upsertAgentConnection({
        userId: "bruno",
        agentId: "main",
        label: "Agente de Bruno",
        wakeTarget: {
          kind: "standard_webhook",
          url: "https://user:pass@hooks.example.com:8443/sideband?token=no-filtrar",
          secret: WAKE_SECRET,
        },
        verifiedAt: minutesAgo(60),
        createdAt: minutesAgo(120),
      })
      await tx.insertRequest({
        ...base,
        id: ids.open,
        status: "awaiting_agent",
        createdAt: minutesAgo(10),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      await tx.insertRequest({
        ...base,
        id: ids.answered,
        status: "answered",
        outcome: "answered",
        result: { answer: SECRET_ANSWER },
        answeredByAgentId: "main",
        responseSignature: "firma-de-respuesta",
        decisionReason: "regla del círculo",
        createdAt: minutesAgo(20),
        expiresAt: minutesAgo(-40),
        closedAt: minutesAgo(19),
      })
      await tx.insertRequest({
        ...base,
        id: ids.stuck,
        status: "awaiting_owner",
        createdAt: minutesAgo(30),
        expiresAt: minutesAgo(5),
      })
      const at = minutesAgo(10)
      await tx.appendEvent({ requestId: ids.open, at, kind: "received" })
      await tx.appendEvent({
        requestId: ids.open,
        at,
        kind: "permission",
        status: "awaiting_agent",
      })
      await tx.enqueueWake({
        id: "wake_open_1",
        requestId: ids.open,
        requestVersion: 0,
        attempt: 1,
        runAt: minutesAgo(10),
        state: "queued",
      })
      await tx.enqueueWake({
        id: "wake_answered_1",
        requestId: ids.answered,
        requestVersion: 0,
        attempt: 1,
        runAt: minutesAgo(20),
        state: "queued",
      })
    })
    // El primer aviso falla y se reintenta; el segundo termina bien.
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + 60_000)
    const claimed = await store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 10))
    expect(claimed.map(({ id }) => id)).toEqual(["wake_answered_1", "wake_open_1"])
    const [answered, open] = claimed
    await store.tx(async (tx) => {
      await tx.appendEvent({
        requestId: ids.open,
        at: minutesAgo(9),
        kind: "wake",
        code: "failed",
      })
      await tx.recordWakeAttempt(
        open!,
        now,
        { ok: false, status: 503, retryable: true, ms: 120 },
        minutesAgo(-1)
      )
      await tx.recordWakeAttempt(
        answered!,
        now,
        { ok: true, status: 200, retryable: false, ms: 80 },
        null
      )
    })

    // Better Auth: identidad, sesión y un cliente OAuth con token activo.
    // The broker no longer writes sharing rules. ops.v_users still shows the stored ones.
    await db.query(`INSERT INTO sideband.sharing_rules (user_id, rules) VALUES ('bruno', $1)`, [
      { circles: { friends: ["alice@sideband.app"] } },
    ])
    await db.query(
      `INSERT INTO public."user" (id, name, email, "emailVerified") VALUES
         ('alice', 'Alice', 'alice@example.com', true), ('bruno', 'Bruno', 'bruno@example.com', true)`
    )
    await db.query(
      `INSERT INTO public.session (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ('s1', now() + interval '1 day', $1, now(), 'alice'),
              ('s2', now() - interval '1 day', 'vencida', now(), 'alice')`,
      [SESSION_TOKEN]
    )
    await db.query(
      `INSERT INTO public."oauthClient" (id, "clientId", "clientSecret", name, "redirectUris", "createdAt")
       VALUES ('c1', 'client-claude', 'client-secret-no-filtrar', 'Claude Code',
               '["http://127.0.0.1:33418/callback", "https://claude.ai/api/mcp/auth_callback"]', now())`
    )
    await db.query(
      `INSERT INTO public."oauthAccessToken" (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes)
       VALUES ('t1', $1, 'client-claude', 'alice', now() + interval '1 hour', now(), '["sideband:ask"]')`,
      [ACCESS_TOKEN]
    )

    // Coordinación.
    await db.query(
      `INSERT INTO people (id, token_hash) VALUES ('ana', 'hash-no-filtrar')`
    )
    await db.query(
      `INSERT INTO memberships (person_id, group_id, can_ask, can_share) VALUES ('ana', 'g1', true, false)`
    )

    // Telemetría.
    await db.query(
      `INSERT INTO ops.events (at, service, instance, kind, name, level, trace_id, span_id, parent_span_id,
                               request_id, user_id, duration_ms, status, error_id, attrs)
       VALUES
         (now() - interval '10 seconds', 'broker', 'host:1', 'lifecycle', 'service.heartbeat', 'info',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"version": "1.2.3"}'),
         (now() - interval '10 minutes', 'mcp', 'host:2', 'lifecycle', 'service.heartbeat', 'info',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"version": "0.9.0"}'),
         (now() - interval '9 minutes', 'mcp', 'host:2', 'http', 'http.request', 'info',
          $1, 'aaaaaaaaaaaaaaa1', NULL, $2, 'alice', 42, '200', NULL, '{"route": "/mcp", "status": 200}'),
         (now() - interval '9 minutes', 'broker', 'host:1', 'lifecycle', 'broker.request.created', 'info',
          $1, 'bbbbbbbbbbbbbbb2', 'aaaaaaaaaaaaaaa1', $2, 'alice', 12, NULL, NULL, '{"tool": "question"}'),
         (now() - interval '5 minutes', 'broker', 'host:1', 'error', 'error', 'error',
          $1, NULL, NULL, $2, NULL, NULL, NULL, $3, '{"operation": "POST /v1/agent/reply", "type": "TypeError"}'),
         (now() - interval '4 minutes', 'broker', 'host:1', 'http', 'http.rate_limited', 'warn',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"route": "/v1/agent/ask", "bucket": "ask"}')`,
      [traceId, ids.open, errorId]
    )
    await db.query(
      `INSERT INTO admin.audit (id, actor_type, actor_id, actor_label, action, target, reason, ip, meta)
       VALUES ($1, 'admin', 'adm_1', 'dev@sideband.local', 'reveal', $2, 'Depurando un reporte del usuario', '127.0.0.1',
               '{"interno": true}'),
              ($3, 'token', 'tok_1', 'sba_abcd1234', 'mcp.call', NULL, NULL, NULL, '{}')`,
      [randomUUID(), ids.answered, randomUUID()]
    )
  }

  it("crea todas las vistas de la tabla 2.2 con los permisos exactos", async () => {
    const { rows } = await db.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'ops'::regnamespace AND relkind = 'v' ORDER BY 1"
    )
    expect(rows.map((row) => row.relname)).toEqual([
      "v_agent_connections",
      "v_ask_receipts",
      "v_channels",
      "v_circles",
      "v_contact_tags",
      "v_coordination_people",
      "v_errors",
      "v_events",
      "v_identities",
      "v_message_turns",
      "v_oauth_clients",
      "v_oauth_grants",
      "v_quota_windows",
      "v_request_events",
      "v_request_payloads",
      "v_requests",
      "v_service_health",
      "v_tag_summary",
      "v_users",
      "v_vault_summary",
      "v_wake_jobs",
    ])
    const grants = await db.query<{ role: string; view: string }>(
      `SELECT grantee AS role, table_name AS view FROM information_schema.role_table_grants
       WHERE table_schema = 'ops' AND grantee LIKE 'sideband\\_%' AND privilege_type = 'SELECT' ORDER BY 1, 2`
    )
    const reveal = grants.rows
      .filter((row) => row.role === "sideband_admin_reveal")
      .map((row) => row.view)
    const readOnly = grants.rows
      .filter((row) => row.role === "sideband_admin_ro")
      .map((row) => row.view)
    expect(reveal).toEqual(["v_request_payloads"])
    expect(readOnly).toEqual(rows.map((row) => row.relname).filter((name) => name !== "v_request_payloads"))
    const audit = await db.query<{ table: string }>(
      `SELECT table_name AS table FROM information_schema.role_table_grants
       WHERE table_schema = 'admin' AND grantee = 'sideband_admin_ro' AND privilege_type = 'SELECT'`
    )
    expect(audit.rows).toEqual([{ table: "audit" }])
  })

  it("sideband_admin_ro no lee las tablas ni el payload; sideband_admin_reveal solo el payload", async () => {
    const client = await db.connect()
    const denied = async (role: string, sql: string) => {
      await client.query("BEGIN READ ONLY")
      try {
        await client.query(`SET LOCAL ROLE ${role}`)
        await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" })
      } finally {
        await client.query("ROLLBACK")
      }
    }
    try {
      await denied("sideband_admin_ro", "SELECT * FROM sideband.requests")
      await denied("sideband_admin_ro", "SELECT * FROM ops.v_request_payloads")
      await denied("sideband_admin_ro", "SELECT * FROM ops.events")
      await denied("sideband_admin_ro", 'SELECT * FROM public."user"')
      await denied("sideband_admin_ro", "SELECT * FROM admin.tokens")
      await denied("sideband_admin_reveal", "SELECT * FROM ops.v_requests")
      await denied("sideband_admin_reveal", "SELECT * FROM sideband.requests")
      await denied("sideband_telemetry_writer", "SELECT * FROM ops.events")
    } finally {
      client.release()
    }
  })

  it("overview resume solicitudes, avisos, errores y servicios", async () => {
    await store.consumeQuota("ana", "ask", 30)
    const overview = Overview.parse(await queries.overview("1h"))
    expect(overview.activeQuotaWindows).toBe(1)
    expect(overview.requests).toMatchObject({ total: 3, open: 2, stuck: 1 })
    expect(overview.requests.byStatus).toMatchObject({
      awaiting_agent: 1,
      awaiting_owner: 1,
      answered: 1,
      expired: 0,
    })
    expect(overview.requests.byTool).toEqual({ question: 3 })
    expect(overview.requests.timeToFinalMs.p50).toBe(60_000)
    expect(overview.wakes).toEqual([
      {
        kind: "standard_webhook",
        ok: 1,
        failed: 0,
        retried: 1,
        p95LatencyMs: expect.any(Number),
      },
    ])
    expect(overview.errors.total).toBe(1)
    expect(overview.errors.top[0]).toMatchObject({
      operation: "POST /v1/agent/reply",
      type: "TypeError",
      count: 1,
    })
    expect(overview.rateLimited).toBe(1)
    expect(
      overview.services.map((service) => [service.service, service.state])
    ).toEqual([
      ["broker", "up"],
      ["mcp", "down"],
    ])
  })

  it("services devuelve el último latido por instancia", async () => {
    const services = z.array(ServiceHealth).parse(await queries.services())
    expect(services[0]).toMatchObject({
      service: "broker",
      instance: "host:1",
      version: "1.2.3",
      state: "up",
    })
  })

  it("requests filtra y pagina con cursor sin repetir filas", async () => {
    const parse = (input: unknown) => RequestFilters.parse(input)
    const first = page(RequestSummary).parse(
      await queries.requests(parse({ limit: 2 }))
    )
    expect(first.items.map((item) => item.id)).toEqual([ids.open, ids.answered])
    expect(first.nextCursor).not.toBeNull()
    const second = await queries.requests(
      parse({ limit: 2, cursor: first.nextCursor })
    )
    expect(second.items.map((item) => item.id)).toEqual([ids.stuck])
    expect(second.nextCursor).toBeNull()

    expect(
      (await queries.requests(parse({ stuck: true }))).items.map(
        (item) => item.id
      )
    ).toEqual([ids.stuck])
    expect(
      (await queries.requests(parse({ status: ["answered"] }))).items
    ).toHaveLength(1)
    expect(
      (await queries.requests(parse({ address: "BRUNO@sideband.app" }))).items
    ).toHaveLength(3)
    expect(
      (await queries.requests(parse({ q: "req_ans" }))).items.map(
        (item) => item.id
      )
    ).toEqual([ids.answered])
    expect((await queries.requests(parse({ q: "req%" }))).items).toHaveLength(0)
    await expectInvalid(queries.requests(parse({ cursor: "no-es-un-cursor" })))
    const invalidDate = Buffer.from(JSON.stringify(["2026-02-30 12:00:00+00", "r1"])).toString("base64url")
    await expectInvalid(queries.requests(parse({ cursor: invalidDate })))

    const open = first.items[0]!
    expect(open).toMatchObject({
      wakeAttempts: 1,
      lastWakeOk: false,
      stuck: false,
      durationMs: null,
    })
  })

  it("request combina la línea de tiempo y nunca incluye el payload", async () => {
    const detail = RequestDetail.parse(await queries.request(ids.open))
    expect(detail.argsKeys).toEqual(["text"])
    expect(detail.hasPurpose).toBe(true)
    expect(detail.responseSigned).toBe(false)
    expect(detail.traceIds).toEqual([traceId])
    expect(detail.wakes).toEqual([
      expect.objectContaining({
        id: "wake_open_1",
        attempt: 2,
        state: "queued",
        kind: "standard_webhook",
        ok: false,
        httpStatus: 503,
        code: "retryable",
      }),
    ])
    const timeline = detail.timeline.map((item) => [item.source, item.name])
    expect(timeline).toEqual([
      ["request_event", "received"],
      ["request_event", "permission"],
      ["request_event", "wake.failed"],
      ["telemetry", "http.request"],
      ["telemetry", "broker.request.created"],
      ["telemetry", "error"],
    ])
    const ats = detail.timeline.map((item) => Date.parse(item.at))
    expect(ats).toEqual([...ats].sort((a, b) => a - b))

    const answered = RequestDetail.parse(await queries.request(ids.answered))
    expect(answered).toMatchObject({
      resultKeys: ["answer"],
      responseSigned: true,
      decisionReason: "regla del círculo",
    })
    expect(answered.summary).toMatchObject({
      outcome: "answered",
      durationMs: 60_000,
      lastWakeOk: true,
    })

    const serialized = JSON.stringify([detail, answered])
    for (const secret of [
      SECRET_QUESTION,
      SECRET_PURPOSE,
      SECRET_ANSWER,
      "firma-",
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(await queries.request("req_no_existe")).toBeNull()
  })

  it("trace, events, errors y error leen la telemetría", async () => {
    const trace = Trace.parse(await queries.trace(traceId))
    expect(trace.spans.map((span) => span.spanId)).toEqual([
      "aaaaaaaaaaaaaaa1",
      "bbbbbbbbbbbbbbb2",
      expect.stringMatching(/^event:/),
    ])
    expect(await queries.trace("no-existe")).toBeNull()

    const history = z
      .array(TelemetryEvent)
      .parse(await queries.events(EventFilters.parse({})))
    expect(history).toHaveLength(6)
    expect(Number(history[0]!.id)).toBeGreaterThan(Number(history[1]!.id))
    const tail = await queries.events(
      EventFilters.parse({ afterId: history[2]!.id })
    )
    expect(tail.map((event) => event.id)).toEqual([
      history[1]!.id,
      history[0]!.id,
    ])
    const older = await queries.events(
      EventFilters.parse({ beforeId: history[4]!.id })
    )
    expect(older.map((event) => event.id)).toEqual([history[5]!.id])
    expect(
      await queries.events(
        EventFilters.parse({ requestId: ids.open, kind: "http" })
      )
    ).toHaveLength(1)
    await expectInvalid(
      queries.events(EventFilters.parse({ afterId: "1 OR 1=1" }))
    )

    const groups = z
      .array(ErrorGroup)
      .parse(await queries.errors(ErrorFilters.parse({ window: "15m" })))
    expect(groups).toEqual([
      expect.objectContaining({
        service: "broker",
        sampleErrorId: errorId,
        count: 1,
      }),
    ])
    expect(
      await queries.errors(
        ErrorFilters.parse({ window: "15m", service: "web" })
      )
    ).toEqual([])

    const error = TelemetryEvent.parse(await queries.error(errorId))
    expect(error.attrs).toMatchObject({ type: "TypeError" })
    expect(await queries.error(randomUUID())).toBeNull()
    expect(await queries.error("x'; DROP TABLE ops.events; --")).toBeNull()
  })

  it("pagina eventos, desempata spans y busca el último error por ID numérico", async () => {
    // A ambos lados de una potencia de diez y fuera del rango exacto de Number.
    const ids = ["9999999999999999", "10000000000000000", "10000000000000001"]
    const errorId = randomUUID()
    const traceId = randomUUID().replaceAll("-", "")
    await db.query(
      `INSERT INTO ops.events (id, at, service, instance, kind, name, level, error_id, trace_id)
       SELECT id, now(), 'broker', 'test', 'error', 'error', 'error', $2, $3
       FROM unnest($1::bigint[]) AS id`,
      [ids, errorId, traceId]
    )
    try {
      const tail = await queries.events(EventFilters.parse({ traceId, afterId: "0", limit: 1 }))
      expect(tail.map((event) => event.id)).toEqual([ids[0]])
      const next = await queries.events(EventFilters.parse({ traceId, afterId: tail[0]!.id, limit: 2 }))
      expect(next.map((event) => event.id)).toEqual(ids.slice(1))

      const latest = await queries.events(EventFilters.parse({ traceId, limit: 1 }))
      expect(latest.map((event) => event.id)).toEqual([ids[2]])
      const older = await queries.events(EventFilters.parse({ traceId, beforeId: latest[0]!.id, limit: 1 }))
      expect(older.map((event) => event.id)).toEqual([ids[1]])

      expect((await queries.error(errorId))?.id).toBe(ids[2])
      expect((await queries.trace(traceId))?.spans.map((span) => span.spanId))
        .toEqual(ids.map((id) => `event:${id}`))
    } finally {
      await db.query("DELETE FROM ops.events WHERE error_id = $1", [errorId])
    }
  })

  it("users y user unen persona, identidad OAuth, reglas, agentes y solicitudes", async () => {
    const users = page(UserSummary).parse(
      await queries.users(UserFilters.parse({}))
    )
    expect(users.items.map((user) => user.userId).sort()).toEqual([
      "alice",
      "bruno",
    ])
    const byEmail = await queries.users(
      UserFilters.parse({ q: "alice@example" })
    )
    expect(byEmail.items.map((user) => user.userId)).toEqual(["alice"])
    const firstPage = await queries.users(UserFilters.parse({ limit: 1 }))
    const nextPage = await queries.users(
      UserFilters.parse({ limit: 1, cursor: firstPage.nextCursor! })
    )
    expect(
      [...firstPage.items, ...nextPage.items].map((user) => user.userId).sort()
    ).toEqual(["alice", "bruno"])

    const alice = UserDetail.parse(await queries.user("alice@sideband.app"))
    expect(alice.summary).toMatchObject({
      userId: "alice",
      sent24h: 3,
      received24h: 0,
      agents: 0,
    })
    expect(alice.identity).toEqual({
      email: "alice@example.com",
      activeSessions: 1,
      oauthClients: [
        {
          clientId: "client-claude",
          name: "Claude Code",
          lastTokenAt: expect.any(String),
          activeTokens: 1,
        },
      ],
    })
    expect(alice.recentRequests).toHaveLength(3)

    const bruno = UserDetail.parse(await queries.user("bruno"))
    expect(bruno.rules).toMatchObject({
      circles: { friends: ["alice@sideband.app"] },
    })
    expect(bruno.agents).toEqual([
      expect.objectContaining({
        agentId: "main",
        wakeHost: "hooks.example.com",
      }),
    ])
    expect(await queries.user("nadie@sideband.app")).toBeNull()

    const serialized = JSON.stringify([alice, bruno])
    for (const secret of [
      SESSION_TOKEN,
      ACCESS_TOKEN,
      WAKE_SECRET,
      "no-filtrar",
      "user:pass",
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("agents y wakeQueue muestran la salud de los avisos sin secretos", async () => {
    const agents = z.array(AgentRow).parse(await queries.agents({}))
    expect(agents).toEqual([
      expect.objectContaining({
        userId: "bruno",
        wakeKind: "standard_webhook",
        wakeHost: "hooks.example.com",
        wakes24h: { ok: 1, failed: 1 },
      }),
    ])
    expect(await queries.agents({ failing: true })).toHaveLength(1)
    expect(await queries.agents({ failing: false })).toHaveLength(0)
    expect(await queries.agents({ kind: "mcp_events" })).toHaveLength(0)

    const queued = z.array(WakeJobRow).parse(await queries.wakeQueue("queued"))
    expect(queued.map((job) => job.id)).toEqual(["wake_open_1"])
    expect((await queries.wakeQueue()).map((job) => job.id)).toEqual([
      "wake_open_1",
      "wake_answered_1",
    ])
    expect(JSON.stringify(agents)).not.toContain(WAKE_SECRET)
  })

  it("flowSnapshot, requestRefs, latestEventId y events por nombre alimentan el flujo sin contenido", async () => {
    const snapshot = FlowSnapshot.parse(await queries.flowSnapshot())
    expect(snapshot.cursor).toBe(await queries.latestEventId())
    expect(snapshot.users.map((user) => user.address)).toEqual(
      expect.arrayContaining(["alice@sideband.app", "bruno@sideband.app"])
    )
    expect(snapshot.agents).toEqual([
      expect.objectContaining({ userId: "bruno", agentId: "main", label: "Agente de Bruno", wakeKind: "standard_webhook", revokedAt: null }),
    ])
    // Abiertas (incluida la atascada) y nada cerrado hace más de 15 min.
    expect(snapshot.requests.map((request) => request.id)).toEqual([ids.open, ids.stuck])
    expect(snapshot.truncated).toBe(false)

    const refs = z
      .array(FlowRequestRef)
      .parse(await queries.requestRefs([ids.answered, ids.answered, "no-existe"]))
    expect(refs).toEqual([
      expect.objectContaining({ id: ids.answered, fromAddress: "alice@sideband.app", toAddress: "bruno@sideband.app", answeredByAgentId: "main" }),
    ])
    expect(await queries.requestRefs([])).toEqual([])

    const named = await queries.events({ ...EventFilters.parse({}), names: ["broker.request.created", "http.rate_limited"] })
    expect(named.map((event) => event.name)).toEqual(["http.rate_limited", "broker.request.created"])
    const tail = await queries.events({ ...EventFilters.parse({ afterId: named[1]!.id }), names: ["broker.request.created"] })
    expect(tail).toEqual([])

    const text = JSON.stringify([snapshot, refs])
    for (const secret of [SECRET_QUESTION, SECRET_PURPOSE, SECRET_ANSWER, WAKE_SECRET, "no-filtrar", "hooks.example.com"]) {
      expect(text).not.toContain(secret)
    }
  })

  it("requestRefs limita a 200 solicitudes distintas antes de buscar las referencias", async () => {
    const missing = Array.from({ length: 199 }, (_, i) => `missing-${i}`)
    const idsToRead = [missing[0]!, ...missing, ids.answered, ids.open]

    const refs = await queries.requestRefs(idsToRead)

    expect(refs.map((ref) => ref.id)).toEqual([ids.answered])
  })

  it("audit pagina la bitácora del admin sin meta", async () => {
    const audit = page(AuditEntry).parse(await queries.audit())
    expect(audit.items.map((entry) => entry.action).sort()).toEqual([
      "mcp.call",
      "reveal",
    ])
    expect(audit.nextCursor).toBeNull()
    expect(JSON.stringify(audit)).not.toContain("interno")

    await db.query(
      `INSERT INTO admin.audit (actor_type, actor_id, actor_label, action)
       SELECT 'token', 'tok_2', 'sba_efgh5678', 'mcp:admin_overview' FROM generate_series(1, 58)`
    )
    const first = page(AuditEntry).parse(await queries.audit())
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()
    const second = page(AuditEntry).parse(
      await queries.audit(first.nextCursor!)
    )
    expect(second.items).toHaveLength(10)
    expect(second.nextCursor).toBeNull()
    const seen = new Set(
      [...first.items, ...second.items].map((entry) => entry.id)
    )
    expect(seen.size).toBe(60)
    await expectInvalid(queries.audit("no-es-un-cursor"))
  })

  describe("sql", () => {
    it("ejecuta un SELECT sobre las vistas y marca truncated", async () => {
      const result = SqlResult.parse(
        await queries.sql("SELECT id, status FROM ops.v_requests ORDER BY id;")
      )
      expect(result.columns).toEqual(["id", "status"])
      expect(result.rows).toHaveLength(3)
      expect(result.truncated).toBe(false)

      const many = await queries.sql(
        "WITH s AS (SELECT generate_series(1, 300) AS n) SELECT n FROM s -- comentario"
      )
      expect(many.rows).toHaveLength(200)
      expect(many.truncated).toBe(true)

      const literal = await queries.sql("SELECT 'a;b' AS texto, now() AS ahora")
      expect(literal.rows[0]![0]).toBe("a;b")
      expect(typeof literal.rows[0]![1]).toBe("string")
    })

    it("rechaza escrituras, varias sentencias y el payload", async () => {
      await expectInvalid(queries.sql("DELETE FROM ops.events"))
      await expectInvalid(queries.sql("delete from sideband.requests where true"))
      await expectInvalid(queries.sql("SELECT 1; DELETE FROM ops.events"))
      await expectInvalid(queries.sql("SELECT 1; SELECT 2"))
      await expectInvalid(queries.sql("SELECT 1 /* sin cerrar"))
      await expectInvalid(queries.sql("SELECT * FROM ops.v_request_payloads"))
      await expectInvalid(queries.sql('SELECT * FROM ops."v_request_payloads"'))
      await expectInvalid(
        queries.sql("SELECT set_config('role', 'none', true)")
      )
      await expectInvalid(
        queries.sql("SELECT query_to_xml('SELECT 1', true, true, '')")
      )
      // Llega a Postgres, pero el rol no tiene permiso.
      await expectInvalid(queries.sql("SELECT args FROM sideband.requests"))
      await expectInvalid(queries.sql("SELECT * FROM ops.events"))
      // Escritura disfrazada dentro de un WITH: la transacción es READ ONLY.
      await expectInvalid(
        queries.sql(
          "WITH d AS (DELETE FROM ops.events RETURNING id) SELECT * FROM d"
        )
      )
      // Intento de cerrar el envoltorio e inyectar otra sentencia.
      await expectInvalid(
        queries.sql(
          "SELECT 1) AS x; DELETE FROM ops.events; SELECT * FROM (SELECT 1"
        )
      )
      const { rows } = await db.query(
        "SELECT count(*)::int AS n FROM ops.events"
      )
      expect(rows[0].n).toBe(6)
    })

    it("corta las consultas que superan 3 s", async () => {
      await expectInvalid(queries.sql("SELECT pg_sleep(5)"), "timeout")
    }, 10_000)
  })

  it("createPgRevealer devuelve el payload real con sideband_admin_reveal", async () => {
    expect(await revealer.reveal(ids.answered)).toEqual({
      args: { text: SECRET_QUESTION },
      purpose: SECRET_PURPOSE,
      result: { answer: SECRET_ANSWER },
    })
    expect(await revealer.reveal("req_no_existe")).toBeNull()
  })
})
