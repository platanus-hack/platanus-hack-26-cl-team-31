import { RequestStatus, type ToolName } from "@team-31/protocol"
import type { z } from "zod"

import {
  ErrorGroup,
  Overview,
  ServiceHealth,
  type ErrorFilters,
  type Window,
} from "../../shared/contract.js"
import { iso, num, numOrNull, Where, type Db } from "./db.js"

const WINDOWS: Record<Window, string> = {
  "15m": "15 minutes",
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
}

export async function errorGroups(
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
  return rows.map((row) =>
    ErrorGroup.parse({
      service: row.service,
      operation: row.operation,
      type: row.type,
      count: num(row.count),
      firstAt: iso(row.first_at),
      lastAt: iso(row.last_at),
      sampleErrorId: row.sample_error_id,
    })
  )
}

export async function services(db: Db): Promise<ServiceHealth[]> {
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

export async function overview(
  db: Db,
  window: Window,
  openStatuses: readonly RequestStatus[]
): Promise<Overview> {
  const interval = WINDOWS[window]
  const health = await services(db)
  const breakdown = await db.query<{
    status: RequestStatus
    tool: ToolName
    count: string
  }>(
    `SELECT status, tool, count(*) AS count FROM ops.v_requests
     WHERE created_at >= now() - $1::interval GROUP BY status, tool`,
    [interval]
  )
  const byStatus = Object.fromEntries(
    RequestStatus.options.map((status) => [status, 0])
  ) as Record<RequestStatus, number>
  const byTool: Record<string, number> = {}
  let total = 0
  for (const { status, tool, count } of breakdown.rows) {
    const n = num(count)
    byStatus[status] += n
    byTool[tool] = (byTool[tool] ?? 0) + n
    total += n
  }
  const {
    rows: [timing],
  } = await db.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
     FROM ops.v_requests
     WHERE created_at >= now() - $1::interval AND duration_ms IS NOT NULL`,
    [interval]
  )
  // Abiertas y atascadas son estado actual, no dependen de la ventana.
  const {
    rows: [open],
  } = await db.query(
    `SELECT count(*) AS open, count(*) FILTER (WHERE stuck) AS stuck
     FROM ops.v_requests WHERE status = ANY($1)`,
    [openStatuses]
  )
  const wakes = await db.query(
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
  )
  const {
    rows: [counts],
  } = await db.query(
    `SELECT now() AS generated_at, count(*) FILTER (WHERE kind = 'error') AS errors,
            count(*) FILTER (WHERE name = 'http.rate_limited') AS rate_limited,
            (SELECT sum(active_windows) FROM ops.v_quota_windows) AS active_windows,
            (SELECT count(*) FROM ops.v_message_turns WHERE phase = 'clarify' AND outcome = 'clarification') AS clarifications
     FROM ops.v_events
     WHERE at >= now() - $1::interval AND (kind = 'error' OR name = 'http.rate_limited')`,
    [interval]
  )
  const top = await errorGroups(db, { window }, 5)
  return Overview.parse({
    window,
    generatedAt: iso(counts!.generated_at),
    services: health,
    requests: {
      total,
      open: num(open?.open),
      stuck: num(open?.stuck),
      byStatus,
      byTool,
      timeToFinalMs: {
        p50: numOrNull(timing?.p50),
        p95: numOrNull(timing?.p95),
      },
    },
    wakes: wakes.rows.map((row) => ({
      kind: row.kind,
      ok: num(row.ok),
      failed: num(row.failed),
      retried: num(row.retried),
      p95LatencyMs: numOrNull(row.p95),
    })),
    errors: { total: num(counts?.errors), top },
    rateLimited: num(counts?.rate_limited),
    awaitingClarifications: num(counts?.clarifications),
    activeQuotaWindows: num(counts?.active_windows),
  })
}
