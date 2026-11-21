import {
  TelemetryEvent,
  type TimelineItem,
  Trace,
  type EventFilters,
} from "../../shared/contract.js"
import { AdminQueryError } from "../../shared/queries.js"
import {
  iso,
  numOrNull,
  scalarAttrs,
  UUID_PATTERN,
  Where,
  type Db,
} from "./db.js"

const TIMELINE_EVENTS = 500
const TRACE_SPANS = 2000

const EVENT_COLUMNS = `id::text AS event_id, at, service, kind, name, level, trace_id, span_id,
  parent_span_id, request_id, user_id, agent_id, duration_ms, status, error_id::text AS error_id, attrs`

const ID_PATTERN = /^\d{1,19}$/

function eventId(value: string, field: string): string {
  if (!ID_PATTERN.test(value))
    throw new AdminQueryError(
      "invalid_input",
      `${field} debe ser un id numérico.`
    )
  return value
}

function toTelemetryEvent(row: Record<string, unknown>): TelemetryEvent {
  return TelemetryEvent.parse({
    id: row.event_id,
    at: iso(row.at as Date | string),
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
    durationMs: numOrNull(row.duration_ms as number | string | null),
    status: row.status ?? null,
    errorId: row.error_id ?? null,
    attrs: scalarAttrs(row.attrs),
  })
}

export async function trace(db: Db, traceId: string): Promise<Trace | null> {
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
}

export async function events(
  db: Db,
  filters: EventFilters & { names?: readonly string[] }
): Promise<TelemetryEvent[]> {
  const where = new Where()
  if (filters.service) where.and(`service = ${where.value(filters.service)}`)
  if (filters.kind) where.and(`kind = ${where.value(filters.kind)}`)
  if (filters.name) where.and(`name = ${where.value(filters.name)}`)
  if (filters.names)
    where.and(`name = ANY(${where.value([...filters.names])}::text[])`)
  if (filters.level) where.and(`level = ${where.value(filters.level)}`)
  if (filters.requestId)
    where.and(`request_id = ${where.value(filters.requestId)}`)
  if (filters.userId) where.and(`user_id = ${where.value(filters.userId)}`)
  if (filters.traceId) where.and(`trace_id = ${where.value(filters.traceId)}`)
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
}

export async function errorEvent(
  db: Db,
  errorId: string
): Promise<TelemetryEvent | null> {
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
}

export async function requestTimeline(
  db: Db,
  id: string
): Promise<TimelineItem[]> {
  const requestEvents = await db.query(
    "SELECT at, kind, status, code FROM ops.v_request_events WHERE request_id = $1 ORDER BY at, id",
    [id]
  )
  const telemetry = await db.query(
    `SELECT ${EVENT_COLUMNS} FROM ops.v_events WHERE request_id = $1 ORDER BY at, id LIMIT ${TIMELINE_EVENTS}`,
    [id]
  )
  return [
    ...requestEvents.rows.map((event): TimelineItem => ({
      at: iso(event.at),
      source: "request_event",
      kind: event.kind,
      name: event.code ? `${event.kind}.${event.code}` : event.kind,
      service: "broker",
      status: event.status ?? null,
      level:
        event.code === "failed" ||
        ["expired", "delivery_failed"].includes(event.status)
          ? "warn"
          : "info",
      durationMs: null,
      traceId: null,
      errorId: null,
      attrs: event.code ? { code: event.code } : {},
    })),
    ...telemetry.rows.map(toTelemetryEvent).map((event): TimelineItem => ({
      at: event.at,
      source: "telemetry",
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
}

export async function requestTraceIds(db: Db, id: string): Promise<string[]> {
  const { rows } = await db.query<{ trace_id: string }>(
    `SELECT trace_id FROM ops.v_events WHERE request_id = $1 AND trace_id IS NOT NULL
     GROUP BY trace_id ORDER BY min(at) LIMIT 50`,
    [id]
  )
  return rows.map((row) => row.trace_id)
}
