import type { Service, TelemetryEvent, Trace } from "@shared/contract"

export type Span = Trace["spans"][number]
type Row = Span & { depth: number; start: number; end: number }

export function layoutTrace({ spans }: Trace) {
  const byParent = new Map<string | null, Span[]>()
  const ids = new Set(spans.map((s) => s.spanId))
  for (const span of spans) {
    // Un padre que no está en la traza (otro servicio sin instrumentar) se trata como raíz.
    const parent =
      span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null
    const siblings = byParent.get(parent)
    if (siblings) siblings.push(span)
    else byParent.set(parent, [span])
  }
  const rows: Row[] = []
  const visit = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).sort((a, b) =>
      a.startAt.localeCompare(b.startAt)
    )
    for (const child of children) {
      const start = Date.parse(child.startAt)
      rows.push({
        ...child,
        depth,
        start,
        end: start + (child.durationMs ?? 0),
      })
      visit(child.spanId, depth + 1)
    }
  }
  visit(null, 0)
  const t0 = rows.length ? Math.min(...rows.map((r) => r.start)) : 0
  const total = Math.max(1, Math.max(...rows.map((r) => r.end)) - t0)
  const first = rows[0]
  const summary = first && {
    total,
    spanCount: spans.length,
    services: [...new Set(rows.map((row) => row.service))],
    errors: rows.filter(isError).length,
    requestId: rows.find((row) => row.requestId)?.requestId,
    startAt: first.startAt,
  }
  return { rows, t0, total, summary }
}

export const isError = (span: Span) =>
  span.level === "error" || span.status === "error" || span.errorId !== null

interface RecentTrace {
  traceId: string
  at: string
  name: string
  services: Set<Service>
  errors: number
  requestId: string | null
}

export function recentTraces({ items }: { items: TelemetryEvent[] }) {
  const byId = new Map<string, RecentTrace>()
  for (const event of items) {
    if (!event.traceId) continue
    let trace = byId.get(event.traceId)
    if (!trace) {
      trace = {
        traceId: event.traceId,
        at: event.at,
        name: event.name,
        services: new Set(),
        errors: 0,
        requestId: event.requestId,
      }
      byId.set(event.traceId, trace)
    }
    trace.services.add(event.service)
    if (event.level === "error" || event.errorId) trace.errors += 1
    if (event.at < trace.at) {
      trace.at = event.at
      trace.name = event.name
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25)
}
