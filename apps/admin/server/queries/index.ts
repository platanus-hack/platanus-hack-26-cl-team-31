// AdminQueries sobre las vistas redactadas ops.v_* (docs/admin.md#22-vistas-adm-02).
// Cada método corre en `BEGIN READ ONLY; SET LOCAL ROLE sideband_admin_ro; statement_timeout 3 s`
// y valida su salida con los esquemas del contrato antes de devolverla.
import { performance } from "node:perf_hooks"

import { RequestStatus } from "@team-31/protocol"
import type pg from "pg"
import type { z } from "zod"

import {
  AgentRow,
  AuditEntry,
  ErrorGroup,
  FlowRequestRef,
  FlowSnapshot,
  Overview,
  RequestDetail,
  RequestSummary,
  ServiceHealth,
  SqlResult,
  TelemetryEvent,
  TimelineItem,
  Trace,
  UserDetail,
  UserSummary,
  WakeJobRow,
  type AgentFilters,
  type ErrorFilters,
  type EventFilters,
  type RequestFilters,
  type UserFilters,
  type Window,
} from "../../shared/contract.js"
import {
  AdminQueryError,
  type AdminQueries,
  type Page,
} from "../../shared/queries.js"
import {
  createPool,
  decodeCursor,
  encodeCursor,
  iso,
  isoOrNull,
  canAssumeRole,
  likeContains,
  likePrefix,
  num,
  numOrNull,
  readOnly,
  scalarAttrs,
  Where,
  type Db,
} from "./db.js"
import { checkReadOnlySql, SQL_MAX_ROWS, wrapWithLimit } from "./sql-guard.js"

export {
  createPgRevealer,
  type PgRevealer,
  type RevealedPayload,
} from "./reveal.js"

export type PgAdminQueriesOptions = { databaseUrl: string }

export interface PgAdminQueries extends AdminQueries {
  close(): Promise<void>
}

const WINDOWS: Record<Window, string> = {
  "15m": "15 minutes",
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
}

const OPEN_STATUSES = ["awaiting_agent", "awaiting_owner"]
const AUDIT_PAGE = 50
const TIMELINE_EVENTS = 500
const TRACE_SPANS = 2000
const RECENT_REQUESTS = 20
const LIST_LIMIT = 500
// Foto del flujo en vivo (página Flujo): límites por lista y ventana de solicitudes recientes.
const FLOW_USERS = 1000
const FLOW_AGENTS = 2000
const FLOW_REQUESTS = 300
const FLOW_REFS = 200
const FLOW_REQUEST_COLUMNS = "id, from_address, to_address, target_agent_id, answered_by_agent_id, status, created_at"

// ---------- Filas de las vistas ----------

type Row = Record<string, unknown>
type Time = Date | string
type Numeric = number | string

const REQUEST_COLUMNS = `id, tool, from_address, to_address, status, outcome, rule, escalated,
  target_agent_id, answered_by_agent_id, wake_attempts, last_wake_ok, created_at, expires_at,
  closed_at, duration_ms, stuck, created_at::text AS cursor_at`

const EVENT_COLUMNS = `id::text AS id, at, service, kind, name, level, trace_id, span_id,
  parent_span_id, request_id, user_id, agent_id, duration_ms, status, error_id::text AS error_id, attrs`

const WAKE_COLUMNS =
  "id, request_id, attempt, state, run_at, kind, ok, http_status, code"

const AGENT_SELECT = `
  SELECT a.user_id, a.agent_id, a.label, a.wake_kind, a.wake_host, a.verified_at, a.last_wake_at,
         a.revoked_at, a.created_at, coalesce(w.ok, 0) AS wakes_ok, coalesce(w.failed, 0) AS wakes_failed
  FROM ops.v_agent_connections a
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE j.ok) AS ok, count(*) FILTER (WHERE j.ok = false) AS failed
    FROM ops.v_wake_jobs j
    WHERE j.user_id = a.user_id AND j.agent_id = a.agent_id AND j.run_at > now() - interval '24 hours'
  ) w ON true`

const USER_SELECT = `
  SELECT u.user_id, u.address, u.display_name, u.created_at, u.rules, u.created_at::text AS cursor_at,
    (SELECT count(*) FROM ops.v_agent_connections a
      WHERE a.user_id = u.user_id AND a.revoked_at IS NULL) AS agents,
    (SELECT count(*) FROM ops.v_requests r
      WHERE r.from_user_id = u.user_id AND r.created_at > now() - interval '24 hours') AS sent24h,
    (SELECT count(*) FROM ops.v_requests r
      WHERE r.to_user_id = u.user_id AND r.created_at > now() - interval '24 hours') AS received24h,
    (SELECT max(r.created_at) FROM ops.v_requests r
      WHERE r.from_user_id = u.user_id OR r.to_user_id = u.user_id) AS last_activity_at
  FROM ops.v_users u`

function toRequestSummary(row: Row): RequestSummary {
  return RequestSummary.parse({
    id: row.id,
    tool: row.tool,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    status: row.status,
    outcome: row.outcome ?? null,
    rule: row.rule,
    escalated: row.escalated,
    targetAgentId: row.target_agent_id ?? null,
    answeredByAgentId: row.answered_by_agent_id ?? null,
    wakeAttempts: num(row.wake_attempts as Numeric),
    lastWakeOk: row.last_wake_ok ?? null,
    createdAt: iso(row.created_at as Time),
    expiresAt: iso(row.expires_at as Time),
    closedAt: isoOrNull(row.closed_at as Time | null),
    durationMs: numOrNull(row.duration_ms as Numeric | null),
    stuck: row.stuck,
  })
}

function toFlowRequestRef(row: Row): FlowRequestRef {
  return FlowRequestRef.parse({
    id: row.id,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    targetAgentId: row.target_agent_id ?? null,
    answeredByAgentId: row.answered_by_agent_id ?? null,
    status: row.status,
    createdAt: iso(row.created_at as Time),
  })
}

function toTelemetryEvent(row: Row): TelemetryEvent {
  return TelemetryEvent.parse({
    id: row.id,
    at: iso(row.at as Time),
    service: row.service,
    kind: row.kind,
    name: row.name,
    level: row.level,
    traceId: row.trace_id ?? null,
    spanId: row.span_id ?? null,
    parentSpanId: row.parent_span_id ?? null,
    requestId: row.request_id ?? null,
    userId: row.user_id ?? null,
    agentId: row.agent_id ?? null,
    durationMs: numOrNull(row.duration_ms as Numeric | null),
    status: row.status ?? null,
    errorId: row.error_id ?? null,
    attrs: scalarAttrs(row.attrs),
  })
}

function toWakeJob(row: Row): WakeJobRow {
  return WakeJobRow.parse({
    id: row.id,
    requestId: row.request_id,
    attempt: num(row.attempt as Numeric),
    state: row.state,
    runAt: iso(row.run_at as Time),
    kind: row.kind ?? null,
    ok: row.ok ?? null,
    httpStatus: numOrNull(row.http_status as Numeric | null),
    code: row.code ?? null,
  })
}

function toAgent(row: Row): AgentRow {
  return AgentRow.parse({
    userId: row.user_id,
    agentId: row.agent_id,
    label: row.label,
    wakeKind: row.wake_kind,
    wakeHost: row.wake_host ?? null,
    verifiedAt: isoOrNull(row.verified_at as Time | null),
    lastWakeAt: isoOrNull(row.last_wake_at as Time | null),
    revokedAt: isoOrNull(row.revoked_at as Time | null),
    createdAt: iso(row.created_at as Time),
    wakes24h: {
      ok: num(row.wakes_ok as Numeric),
      failed: num(row.wakes_failed as Numeric),
    },
  })
}

function toUserSummary(row: Row): UserSummary {
  return UserSummary.parse({
    userId: row.user_id,
    address: row.address ?? null,
    displayName: row.display_name ?? null,
    createdAt: iso(row.created_at as Time),
    agents: num(row.agents as Numeric),
    sent24h: num(row.sent24h as Numeric),
    received24h: num(row.received24h as Numeric),
    lastActivityAt: isoOrNull(row.last_activity_at as Time | null),
  })
}

function toErrorGroup(row: Row): ErrorGroup {
  return ErrorGroup.parse({
    service: row.service,
    operation: row.operation,
    type: row.type,
    count: num(row.count as Numeric),
    firstAt: iso(row.first_at as Time),
    lastAt: iso(row.last_at as Time),
    sampleErrorId: row.sample_error_id,
  })
}

// Página por keyset: pide limit + 1 filas para saber si hay más.
function page<T>(
  rows: Row[],
  limit: number,
  map: (row: Row) => T,
  cursorOf: (row: Row) => string
): Page<T> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map(map),
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  }
}

// Un cliente de pg ejecuta una consulta a la vez: las corre en orden dentro de la transacción.
async function inOrder<T extends readonly (() => Promise<unknown>)[]>(
  ...steps: T
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = []
  for (const step of steps) results.push(await step())
  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> }
}

async function viewExists(db: Db, view: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS ok",
    [view]
  )
  return rows[0]?.ok === true
}

const ID_PATTERN = /^\d{1,19}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function eventId(value: string, field: string): string {
  if (!ID_PATTERN.test(value))
    throw new AdminQueryError(
      "invalid_input",
      `${field} debe ser un id numérico.`
    )
  return value
}

async function errorGroups(
  db: Db,
  filters: z.infer<typeof ErrorFilters>,
  limit: number
): Promise<ErrorGroup[]> {
  const where = new Where()
  where.and(
    `bucket >= date_trunc('minute', now() - ${where.value(WINDOWS[filters.window])}::interval)`
  )
  if (filters.service) where.and(`service = ${where.value(filters.service)}`)
  if (filters.operation)
    where.and(`operation = ${where.value(filters.operation)}`)
  const { rows } = await db.query(
    `SELECT service, operation, type, sum(count) AS count, min(first_at) AS first_at, max(last_at) AS last_at,
            (array_agg(sample_error_id ORDER BY last_at DESC))[1] AS sample_error_id
     FROM ops.v_errors ${where}
     GROUP BY service, operation, type
     ORDER BY count DESC, last_at DESC
     LIMIT ${limit}`,
    where.params
  )
  return rows.map(toErrorGroup)
}

async function services(db: Db): Promise<ServiceHealth[]> {
  const { rows } = await db.query(
    "SELECT service, instance, version, last_seen_at, state FROM ops.v_service_health ORDER BY service, instance"
  )
  return rows.map((row) =>
    ServiceHealth.parse({
      service: row.service,
      instance: row.instance,
      version: row.version ?? null,
      lastSeenAt: iso(row.last_seen_at),
      state: row.state,
    })
  )
}

async function agentsOf(db: Db, where: Where): Promise<AgentRow[]> {
  const { rows } = await db.query(
    `${AGENT_SELECT} ${where} ORDER BY a.created_at DESC, a.user_id, a.agent_id LIMIT ${LIST_LIMIT}`,
    where.params
  )
  return rows.map(toAgent)
}

function sqlValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString("base64")
  return value
}

// Errores de la consulta del usuario (sintaxis, permisos, tipos, solo lectura) → invalid_input.
function userSqlError(error: unknown): unknown {
  const code = (error as { code?: unknown } | undefined)?.code
  if (typeof code === "string" && /^(42|22|25|0A|2B|21|23)/.test(code)) {
    return new AdminQueryError("invalid_input", (error as Error).message)
  }
  return error
}

export function createPgAdminQueries({
  databaseUrl,
}: PgAdminQueriesOptions): PgAdminQueries {
  const pool = createPool(databaseUrl)
  const ro = <T>(fn: (db: Db) => Promise<T>) =>
    readOnly(pool, "sideband_admin_ro", fn)

  return {
    overview: (window) =>
      ro(async (db) => {
        const interval = WINDOWS[window]
        const [
          health,
          statuses,
          tools,
          timing,
          open,
          wakes,
          counts,
          top,
          generated,
        ] = await inOrder(
          async () => services(db),
          async () =>
            db.query(
              `SELECT status, count(*) AS n FROM ops.v_requests
             WHERE created_at >= now() - $1::interval GROUP BY status`,
              [interval]
            ),
          async () =>
            db.query(
              `SELECT tool, count(*) AS n FROM ops.v_requests
             WHERE created_at >= now() - $1::interval GROUP BY tool`,
              [interval]
            ),
          async () =>
            db.query(
              `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
             FROM ops.v_requests
             WHERE created_at >= now() - $1::interval AND duration_ms IS NOT NULL`,
              [interval]
            ),
          // Abiertas y atascadas son estado actual, no dependen de la ventana.
          async () =>
            db.query(
              `SELECT count(*) AS open, count(*) FILTER (WHERE stuck) AS stuck
             FROM ops.v_requests WHERE status = ANY($1)`,
              [OPEN_STATUSES]
            ),
          async () =>
            db.query(
              `SELECT kind,
                    count(*) FILTER (WHERE state = 'done' AND ok) AS ok,
                    count(*) FILTER (WHERE state = 'done' AND ok = false) AS failed,
                    count(*) FILTER (WHERE attempt > 1) AS retried,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
                      FILTER (WHERE latency_ms IS NOT NULL) AS p95
             FROM ops.v_wake_jobs
             WHERE run_at >= now() - $1::interval AND kind IS NOT NULL
             GROUP BY kind ORDER BY kind`,
              [interval]
            ),
          async () =>
            db.query(
              `SELECT count(*) FILTER (WHERE kind = 'error') AS errors,
                    count(*) FILTER (WHERE name = 'http.rate_limited') AS rate_limited,
                    (SELECT sum(active_windows) FROM ops.v_quota_windows) AS active_windows,
                    (SELECT count(*) FROM ops.v_message_turns WHERE phase = 'clarify' AND outcome = 'clarification') AS clarifications
             FROM ops.v_events
             WHERE at >= now() - $1::interval AND (kind = 'error' OR name = 'http.rate_limited')`,
              [interval]
            ),
          async () => errorGroups(db, { window }, 5),
          async () => db.query<{ now: Date }>("SELECT now() AS now")
        )
        const byStatus = Object.fromEntries(
          RequestStatus.options.map((status) => [status, 0])
        ) as Record<RequestStatus, number>
        let total = 0
        for (const row of statuses.rows) {
          byStatus[row.status as RequestStatus] = num(row.n)
          total += num(row.n)
        }
        return Overview.parse({
          window,
          generatedAt: iso(generated.rows[0]!.now),
          services: health,
          requests: {
            total,
            open: num(open.rows[0]?.open),
            stuck: num(open.rows[0]?.stuck),
            byStatus,
            byTool: Object.fromEntries(
              tools.rows.map((row) => [row.tool, num(row.n)])
            ),
            timeToFinalMs: {
              p50: numOrNull(timing.rows[0]?.p50),
              p95: numOrNull(timing.rows[0]?.p95),
            },
          },
          wakes: wakes.rows.map((row) => ({
            kind: row.kind,
            ok: num(row.ok),
            failed: num(row.failed),
            retried: num(row.retried),
            p95LatencyMs: numOrNull(row.p95),
          })),
          errors: { total: num(counts.rows[0]?.errors), top },
          rateLimited: num(counts.rows[0]?.rate_limited),
          awaitingClarifications: num(counts.rows[0]?.clarifications),
          activeQuotaWindows: num(counts.rows[0]?.active_windows),
        })
      }),

    services: () => ro(services),

    requests: (filters: RequestFilters) =>
      ro(async (db) => {
        const where = new Where()
        if (filters.status?.length)
          where.and(`status = ANY(${where.value(filters.status)})`)
        if (filters.tool) where.and(`tool = ${where.value(filters.tool)}`)
        if (filters.address) {
          const address = where.value(filters.address.toLowerCase())
          where.and(`(from_address = ${address} OR to_address = ${address})`)
        }
        if (filters.q)
          where.and(`id LIKE ${where.value(likePrefix(filters.q))}`)
        if (filters.stuck !== undefined)
          where.and(`stuck = ${where.value(filters.stuck)}`)
        if (filters.since)
          where.and(`created_at >= ${where.value(filters.since)}::timestamptz`)
        if (filters.until)
          where.and(`created_at < ${where.value(filters.until)}::timestamptz`)
        if (filters.cursor) {
          const [at, id] = decodeCursor(filters.cursor)
          where.and(
            `(created_at, id) < (${where.value(at)}::timestamptz, ${where.value(id)})`
          )
        }
        const { rows } = await db.query(
          `SELECT ${REQUEST_COLUMNS} FROM ops.v_requests ${where}
           ORDER BY created_at DESC, id DESC LIMIT ${filters.limit + 1}`,
          where.params
        )
        return page(rows, filters.limit, toRequestSummary, (row) =>
          encodeCursor(row.cursor_at as string, row.id as string)
        )
      }),

    request: (id) =>
      ro(async (db) => {
        const { rows } = await db.query(
          `SELECT ${REQUEST_COLUMNS}, allowed_fields, dropped_fields, decision_reason, internal_reason,
                  args_keys, result_keys, has_purpose, response_signed,
                  (SELECT receipt_count FROM ops.v_ask_receipts WHERE request_id = $1) AS receipt_count
           FROM ops.v_requests WHERE id = $1`,
          [id]
        )
        const row = rows[0]
        if (!row) return null
        const [requestEvents, telemetry, wakes, traces] = await inOrder(
          async () =>
            db.query(
              "SELECT at, kind, status, code FROM ops.v_request_events WHERE request_id = $1 ORDER BY at, id",
              [id]
            ),
          async () =>
            db.query(
              `SELECT ${EVENT_COLUMNS} FROM ops.v_events WHERE request_id = $1 ORDER BY at, id LIMIT ${TIMELINE_EVENTS}`,
              [id]
            ),
          async () =>
            db.query(
              `SELECT ${WAKE_COLUMNS} FROM ops.v_wake_jobs WHERE request_id = $1 ORDER BY run_at, id`,
              [id]
            ),
          async () =>
            db.query(
              `SELECT trace_id FROM ops.v_events WHERE request_id = $1 AND trace_id IS NOT NULL
             GROUP BY trace_id ORDER BY min(at) LIMIT 50`,
              [id]
            )
        )
        const timeline: TimelineItem[] = [
          ...requestEvents.rows.map((event) => ({
            at: iso(event.at),
            source: "request_event" as const,
            kind: event.kind,
            name: event.code ? `${event.kind}.${event.code}` : event.kind,
            service: "broker" as const,
            status: event.status ?? null,
            level:
              event.code === "failed" ||
              ["expired", "delivery_failed"].includes(event.status)
                ? ("warn" as const)
                : ("info" as const),
            durationMs: null,
            traceId: null,
            errorId: null,
            attrs: (event.code
              ? { code: event.code }
              : {}) as TimelineItem["attrs"],
          })),
          ...telemetry.rows.map(toTelemetryEvent).map((event) => ({
            at: event.at,
            source: "telemetry" as const,
            kind: event.kind,
            name: event.name,
            service: event.service,
            status: event.status,
            level: event.level,
            durationMs: event.durationMs,
            traceId: event.traceId,
            errorId: event.errorId,
            attrs: event.attrs,
          })),
        ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        return RequestDetail.parse({
          summary: toRequestSummary(row),
          idempotentReceipts: Number(row.receipt_count ?? 0),
          allowedFields: row.allowed_fields ?? [],
          droppedFields: row.dropped_fields ?? [],
          decisionReason: row.decision_reason ?? null,
          internalReason: row.internal_reason ?? null,
          argsKeys: row.args_keys ?? [],
          resultKeys: row.result_keys ?? [],
          hasPurpose: row.has_purpose,
          responseSigned: row.response_signed,
          timeline,
          wakes: wakes.rows.map(toWakeJob),
          traceIds: traces.rows.map((trace) => trace.trace_id),
        })
      }),

    trace: (traceId) =>
      ro(async (db) => {
        const { rows } = await db.query(
          `SELECT ${EVENT_COLUMNS} FROM ops.v_events WHERE trace_id = $1 ORDER BY at, id LIMIT ${TRACE_SPANS}`,
          [traceId]
        )
        if (!rows.length) return null
        return Trace.parse({
          traceId,
          spans: rows.map(toTelemetryEvent).map((event) => ({
            // Los eventos sueltos de la traza (sin span propio) se muestran como spans instantáneos.
            spanId: event.spanId ?? `event:${event.id}`,
            parentSpanId: event.parentSpanId,
            service: event.service,
            name: event.name,
            startAt: event.at,
            durationMs: event.durationMs,
            status: event.status,
            level: event.level,
            requestId: event.requestId,
            errorId: event.errorId,
            attrs: event.attrs,
          })),
        })
      }),

    events: (filters: EventFilters & { names?: readonly string[] }) =>
      ro(async (db) => {
        const where = new Where()
        if (filters.service)
          where.and(`service = ${where.value(filters.service)}`)
        if (filters.kind) where.and(`kind = ${where.value(filters.kind)}`)
        if (filters.name) where.and(`name = ${where.value(filters.name)}`)
        if (filters.names)
          where.and(`name = ANY(${where.value([...filters.names])}::text[])`)
        if (filters.level) where.and(`level = ${where.value(filters.level)}`)
        if (filters.requestId)
          where.and(`request_id = ${where.value(filters.requestId)}`)
        if (filters.userId)
          where.and(`user_id = ${where.value(filters.userId)}`)
        if (filters.traceId)
          where.and(`trace_id = ${where.value(filters.traceId)}`)
        if (filters.afterId)
          where.and(
            `id > ${where.value(eventId(filters.afterId, "afterId"))}::bigint`
          )
        if (filters.beforeId)
          where.and(
            `id < ${where.value(eventId(filters.beforeId, "beforeId"))}::bigint`
          )
        // Con afterId es una cola (ascendente); si no, historial (lo más nuevo primero).
        const order = filters.afterId ? "ASC" : "DESC"
        const { rows } = await db.query(
          `SELECT ${EVENT_COLUMNS} FROM ops.v_events ${where} ORDER BY id ${order} LIMIT ${filters.limit}`,
          where.params
        )
        return rows.map(toTelemetryEvent)
      }),

    latestEventId: () =>
      ro(async (db) => {
        const { rows } = await db.query<{ id: string | null }>(
          "SELECT max(id)::text AS id FROM ops.v_events"
        )
        return rows[0]?.id ?? null
      }),

    errors: (filters) => ro((db) => errorGroups(db, filters, 100)),

    error: (errorId) =>
      ro(async (db) => {
        const lookup = UUID_PATTERN.test(errorId)
          ? { clause: "error_id = $1::uuid", value: errorId }
          : ID_PATTERN.test(errorId)
            ? { clause: "id = $1::bigint", value: errorId }
            : null
        if (!lookup) return null
        const { rows } = await db.query(
          `SELECT ${EVENT_COLUMNS} FROM ops.v_events WHERE kind = 'error' AND ${lookup.clause}
           ORDER BY id DESC LIMIT 1`,
          [lookup.value]
        )
        return rows[0] ? toTelemetryEvent(rows[0]) : null
      }),

    users: (filters: z.infer<typeof UserFilters>) =>
      ro(async (db) => {
        const where = new Where()
        if (filters.q) {
          const prefix = where.value(likePrefix(filters.q))
          const contains = where.value(likeContains(filters.q))
          const email = (await viewExists(db, "ops.v_identities"))
            ? ` OR EXISTS (SELECT 1 FROM ops.v_identities i WHERE i.user_id = u.user_id AND i.email ILIKE ${contains})`
            : ""
          where.and(
            `(u.user_id LIKE ${prefix} OR u.address ILIKE ${contains} OR u.display_name ILIKE ${contains}${email})`
          )
        }
        if (filters.cursor) {
          const [at, id] = decodeCursor(filters.cursor)
          where.and(
            `(u.created_at, u.user_id) < (${where.value(at)}::timestamptz, ${where.value(id)})`
          )
        }
        const { rows } = await db.query(
          `${USER_SELECT} ${where} ORDER BY u.created_at DESC, u.user_id DESC LIMIT ${filters.limit + 1}`,
          where.params
        )
        return page(rows, filters.limit, toUserSummary, (row) =>
          encodeCursor(row.cursor_at as string, row.user_id as string)
        )
      }),

    user: (idOrAddress) =>
      ro(async (db) => {
        const { rows } = await db.query(
          `${USER_SELECT} WHERE u.user_id = $1 OR u.address = lower($1)
           ORDER BY (u.user_id = $1) DESC LIMIT 1`,
          [idOrAddress]
        )
        const row = rows[0]
        if (!row) return null
        const userId = row.user_id as string
        const byUser = new Where()
        byUser.and(`a.user_id = ${byUser.value(userId)}`)
        const [hasIdentities, hasGrants] = await inOrder(
          async () => viewExists(db, "ops.v_identities"),
          async () => viewExists(db, "ops.v_oauth_grants")
        )
        const [identity, grants, agents, recent] = await inOrder(
          async () =>
            hasIdentities
              ? db.query(
                  "SELECT email, active_sessions FROM ops.v_identities WHERE user_id = $1",
                  [userId]
                )
              : null,
          async () =>
            hasGrants
              ? db.query(
                  `SELECT client_id, client_name, last_token_at, active_tokens FROM ops.v_oauth_grants
                 WHERE user_id = $1 ORDER BY last_token_at DESC NULLS LAST, client_id`,
                  [userId]
                )
              : null,
          async () => agentsOf(db, byUser),
          async () =>
            db.query(
              `SELECT ${REQUEST_COLUMNS} FROM ops.v_requests
             WHERE from_user_id = $1 OR to_user_id = $1
             ORDER BY created_at DESC, id DESC LIMIT ${RECENT_REQUESTS}`,
              [userId]
            )
        )
        return UserDetail.parse({
          vaultContactGroups: await viewExists(db, "ops.v_vault_contact_group_summary")
            ? (await db.query("SELECT groups::int, memberships::int, permissions::int FROM ops.v_vault_contact_group_summary WHERE user_id = $1", [userId])).rows[0]
              ?? { groups: 0, memberships: 0, permissions: 0 } : undefined,
          vault: await viewExists(db, "ops.v_vault_summary")
            ? (await db.query("SELECT categories::int, entries::int, permissions::int FROM ops.v_vault_summary WHERE user_id = $1", [userId])).rows[0]
              ?? { categories: 0, entries: 0, permissions: 0 } : undefined,
          summary: toUserSummary(row),
          identity: {
            email: identity?.rows[0]?.email ?? null,
            activeSessions: num(identity?.rows[0]?.active_sessions),
            oauthClients: (grants?.rows ?? []).map((grant) => ({
              clientId: grant.client_id,
              name: grant.client_name ?? null,
              lastTokenAt: isoOrNull(grant.last_token_at),
              activeTokens: num(grant.active_tokens),
            })),
          },
          rules: row.rules ?? null,
          agents,
          recentRequests: recent.rows.map(toRequestSummary),
        })
      }),

    agents: (filters: z.infer<typeof AgentFilters>) =>
      ro(async (db) => {
        const where = new Where()
        if (filters.kind)
          where.and(`a.wake_kind = ${where.value(filters.kind)}`)
        if (filters.failing !== undefined) {
          where.and(
            filters.failing
              ? "coalesce(w.failed, 0) > 0"
              : "coalesce(w.failed, 0) = 0"
          )
        }
        return agentsOf(db, where)
      }),

    wakeQueue: (state) =>
      ro(async (db) => {
        const where = new Where()
        if (state) where.and(`state = ${where.value(state)}`)
        // La cola pendiente se lee en orden de ejecución; el historial, lo más nuevo primero.
        const order = state === "queued" || state === "running" ? "ASC" : "DESC"
        const { rows } = await db.query(
          `SELECT ${WAKE_COLUMNS} FROM ops.v_wake_jobs ${where} ORDER BY run_at ${order}, id LIMIT ${LIST_LIMIT}`,
          where.params
        )
        return rows.map(toWakeJob)
      }),

    flowSnapshot: () =>
      ro(async (db) => {
        // El cursor va primero: lo que se escriba mientras se leen las listas llega por el stream
        // (y el cliente descarta duplicados).
        const [cursor, users, agents, requests, now] = await inOrder(
          async () =>
            db.query<{ id: string | null }>("SELECT max(id)::text AS id FROM ops.v_events"),
          async () =>
            db.query(
              `SELECT user_id, address, display_name FROM ops.v_users
               ORDER BY address IS NULL, created_at DESC, user_id LIMIT ${FLOW_USERS + 1}`
            ),
          async () =>
            db.query(
              `SELECT user_id, agent_id, label, wake_kind, verified_at, revoked_at, created_at
               FROM ops.v_agent_connections
               WHERE revoked_at IS NULL OR revoked_at > now() - interval '24 hours'
               ORDER BY created_at DESC, user_id, agent_id LIMIT ${FLOW_AGENTS + 1}`
            ),
          async () =>
            db.query(
              `SELECT ${FLOW_REQUEST_COLUMNS} FROM ops.v_requests
               WHERE status = ANY($1::text[]) OR created_at > now() - interval '15 minutes'
                 OR closed_at > now() - interval '15 minutes'
               ORDER BY created_at DESC, id LIMIT ${FLOW_REQUESTS + 1}`,
              [OPEN_STATUSES]
            ),
          async () => db.query<{ now: Date }>("SELECT now() AS now")
        )
        return FlowSnapshot.parse({
          generatedAt: iso(now.rows[0]!.now),
          cursor: cursor.rows[0]?.id ?? null,
          users: users.rows.slice(0, FLOW_USERS).map((row) => ({
            userId: row.user_id,
            address: row.address ?? null,
            displayName: row.display_name ?? null,
          })),
          agents: agents.rows.slice(0, FLOW_AGENTS).map((row) => ({
            userId: row.user_id,
            agentId: row.agent_id,
            label: row.label,
            wakeKind: row.wake_kind,
            verifiedAt: isoOrNull(row.verified_at),
            revokedAt: isoOrNull(row.revoked_at),
            createdAt: iso(row.created_at),
          })),
          requests: requests.rows.slice(0, FLOW_REQUESTS).map(toFlowRequestRef),
          truncated:
            users.rows.length > FLOW_USERS ||
            agents.rows.length > FLOW_AGENTS ||
            requests.rows.length > FLOW_REQUESTS,
        })
      }),

    requestRefs: (ids) =>
      ro(async (db) => {
        const wanted = [...new Set(ids)].slice(0, FLOW_REFS)
        if (wanted.length === 0) return []
        const { rows } = await db.query(
          `SELECT ${FLOW_REQUEST_COLUMNS} FROM ops.v_requests WHERE id = ANY($1::text[])`,
          [wanted]
        )
        return rows.map(toFlowRequestRef)
      }),

    audit: (cursor) =>
      ro(async (db) => {
        // admin.audit es del servidor admin (ADM-04); sideband_admin_ro tiene SELECT solo sobre esa
        // tabla (packages/ops/sql/0003_roles.sql). Sin ella, no hay entradas. Nunca se lee meta.
        const { rows: found } = await db.query<{ ok: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'admin' AND c.relname = 'audit') AS ok`
        )
        if (!found[0]?.ok) return { items: [], nextCursor: null }
        const where = new Where()
        if (cursor) {
          const [at, id] = decodeCursor(cursor)
          if (!UUID_PATTERN.test(id)) {
            throw new AdminQueryError("invalid_input", "Cursor inválido.")
          }
          where.and(
            `(at, id) < (${where.value(at)}::timestamptz, ${where.value(id)}::uuid)`
          )
        }
        const { rows } = await db.query(
          `SELECT id::text AS id, at, actor_type, actor_id, actor_label, action, target, reason, ip,
                  at::text AS cursor_at
           FROM admin.audit ${where} ORDER BY at DESC, id DESC LIMIT ${AUDIT_PAGE + 1}`,
          where.params
        )
        return page(
          rows,
          AUDIT_PAGE,
          (row) =>
            AuditEntry.parse({
              id: row.id,
              at: iso(row.at as Time),
              actorType: row.actor_type,
              actorId: row.actor_id,
              actorLabel: row.actor_label,
              action: row.action,
              target: row.target ?? null,
              reason: row.reason ?? null,
              ip: row.ip ?? null,
            }),
          (row) => encodeCursor(row.cursor_at as string, row.id as string)
        )
      }),

    sql: async (text) => {
      const query = checkReadOnlySql(text)
      if (!(await canAssumeRole(pool, "sideband_admin_ro"))) {
        throw new AdminQueryError(
          "invalid_input",
          "SQL deshabilitado: el usuario de base no puede asumir sideband_admin_ro (modo degradado, ver docs/admin.md#producción)."
        )
      }
      return ro(async (db) => {
        const started = performance.now()
        // Protocolo extendido: Postgres rechaza más de una sentencia aunque el filtro fallara.
        const config = {
          text: wrapWithLimit(query),
          rowMode: "array",
          queryMode: "extended",
        } as pg.QueryArrayConfig
        const result = await db.query(config).catch((error: unknown) => {
          throw userSqlError(error)
        })
        return SqlResult.parse({
          columns: result.fields.map((field) => field.name),
          rows: result.rows
            .slice(0, SQL_MAX_ROWS)
            .map((row) => row.map(sqlValue)),
          truncated: result.rows.length > SQL_MAX_ROWS,
          durationMs: Math.round(performance.now() - started),
        })
      })
    },

    close: () => pool.end(),
  }
}
