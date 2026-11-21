import { expect, it } from "vitest"
import type { TelemetryEvent } from "@shared/contract"
import { layoutTrace, recentTraces, type Span } from "./model"

const at = (ms: number) => new Date(ms).toISOString()
const root: Span = {
  spanId: "root", parentSpanId: null, startAt: at(10), durationMs: 40,
  name: "http.request", service: "web", level: "info", status: null,
  errorId: null, requestId: null, attrs: {},
}

it("ordena raíces y hermanos y usa la misma escala para la cascada y el resumen", () => {
  const child = { ...root, parentSpanId: "root", durationMs: null }
  const trace = layoutTrace({ traceId: "trace", spans: [
    { ...child, spanId: "last", startAt: at(15), status: "error" },
    { ...root, spanId: "orphan", parentSpanId: "missing", startAt: at(60), errorId: "err" },
    { ...child, spanId: "first", service: "broker", requestId: "req", startAt: at(12) },
    root,
  ] })

  expect(trace.rows.map(({ spanId, depth, end }) => [spanId, depth, end])).toEqual([
    ["root", 0, 50], ["first", 1, 12], ["last", 1, 15], ["orphan", 0, 100],
  ])
  expect(trace.t0).toBe(10)
  expect(trace.total).toBe(90)
  expect(trace.summary).toEqual({
    total: trace.total, spanCount: 4, errors: 2, services: ["web", "broker"],
    requestId: "req", startAt: root.startAt,
  })
})

it("agrupa los eventos por traza y ordena las 25 más recientes por su inicio", () => {
  const event: TelemetryEvent = {
    ...root, service: "broker", kind: "http", id: "1", at: at(0),
    traceId: null, userId: null, agentId: null,
  }
  const items = Array.from({ length: 26 }, (_, i) => ({
    ...event, traceId: String(i), at: at(i),
  }))
  const traces = recentTraces({ items: [
    { ...event, traceId: "0", at: at(100) },
    { ...event, traceId: "25", at: at(200), service: "mcp", name: "http.response", level: "error" },
    { ...event, at: at(300) },
    ...items,
  ] })
  expect(traces.map((trace) => trace.traceId)).toEqual(items.slice(1).reverse().map((e) => e.traceId))
  expect(traces[0]).toMatchObject({
    at: at(25), services: new Set(["mcp", "broker"]), errors: 1, name: event.name,
  })
})
