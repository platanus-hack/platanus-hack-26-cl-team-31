// AdminQueries sobre las vistas redactadas ops.v_* (docs/admin.md#22-vistas-adm-02).
// Cada método corre en `BEGIN READ ONLY; SET LOCAL ROLE sideband_admin_ro; statement_timeout 3 s`
// y valida su salida con los esquemas del contrato antes de devolverla.
import { performance } from "node:perf_hooks"

import type { RequestStatus } from "@team-31/protocol"
import type pg from "pg"
import type { z } from "zod"

import {
  AgentRow,
  AuditEntry,
  RequestDetail,
  RequestSummary,
  SqlResult,
  UserDetail,
  UserSummary,
  WakeJobRow,
  type AgentFilters,
  type RequestFilters,
  type UserFilters,
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
  UUID_PATTERN,
  Where,
  type Db,
} from "./db.js"
import { errorEvent, events, requestTimeline, requestTraceIds, trace } from "./events.js"
import { flowSnapshot, latestEventId, requestRefs } from "./flow.js"
import { errorGroups, overview, services } from "./overview.js"
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

const OPEN_STATUSES = ["awaiting_agent", "awaiting_owner"] satisfies RequestStatus[]
const AUDIT_PAGE = 50
const RECENT_REQUESTS = 20
const LIST_LIMIT = 500
// ---------- Filas de las vistas ----------

type Row = Record<string, unknown>
type Time = Date | string
type Numeric = number | string

const REQUEST_COLUMNS = `id, tool, from_address, to_address, status, outcome, rule, escalated,
  target_agent_id, answered_by_agent_id, wake_attempts, last_wake_ok, created_at, expires_at,
  closed_at, duration_ms, stuck, created_at::text AS cursor_at`

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

async function viewExists(db: Db, view: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS ok",
    [view]
  )
  return rows[0]?.ok === true
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
    overview: (window) => ro((db) => overview(db, window, OPEN_STATUSES)),

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
        const timeline = await requestTimeline(db, id)
        const wakes = await db.query(
          `SELECT ${WAKE_COLUMNS} FROM ops.v_wake_jobs WHERE request_id = $1 ORDER BY run_at, id`,
          [id]
        )
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
          traceIds: await requestTraceIds(db, id),
        })
      }),

    trace: (traceId) => ro((db) => trace(db, traceId)),

    events: (filters) => ro((db) => events(db, filters)),

    latestEventId: () => ro(latestEventId),

    errors: (filters) => ro((db) => errorGroups(db, filters, 100)),

    error: (errorId) => ro((db) => errorEvent(db, errorId)),

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
        const hasIdentities = await viewExists(db, "ops.v_identities")
        const hasGrants = await viewExists(db, "ops.v_oauth_grants")
        const identity = hasIdentities
          ? await db.query(
              "SELECT email, active_sessions FROM ops.v_identities WHERE user_id = $1",
              [userId]
            )
          : null
        const grants = hasGrants
          ? await db.query(
              `SELECT client_id, client_name, last_token_at, active_tokens FROM ops.v_oauth_grants
               WHERE user_id = $1 ORDER BY last_token_at DESC NULLS LAST, client_id`,
              [userId]
            )
          : null
        const agents = await agentsOf(db, byUser)
        const recent = await db.query(
          `SELECT ${REQUEST_COLUMNS} FROM ops.v_requests
           WHERE from_user_id = $1 OR to_user_id = $1
           ORDER BY created_at DESC, id DESC LIMIT ${RECENT_REQUESTS}`,
          [userId]
        )
        return UserDetail.parse({
          tags: await viewExists(db, "ops.v_tag_summary")
            ? (await db.query(`SELECT tags::int, custom_tags::int AS "customTags", memberships::int, vault_permissions::int AS "vaultPermissions" FROM ops.v_tag_summary WHERE user_id = $1`, [userId])).rows[0]
              ?? { tags: 0, customTags: 0, memberships: 0, vaultPermissions: 0 } : undefined,
          vault: await viewExists(db, "ops.v_vault_summary")
            ? (await db.query(`SELECT categories::int, entries::int, permissions::int, member_rules::int AS "memberRules" FROM ops.v_vault_summary WHERE user_id = $1`, [userId])).rows[0]
              ?? { categories: 0, entries: 0, permissions: 0, memberRules: 0 } : undefined,
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

    flowSnapshot: () => ro((db) => flowSnapshot(db, OPEN_STATUSES)),
    requestRefs: (ids) => ro((db) => requestRefs(db, ids)),

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
