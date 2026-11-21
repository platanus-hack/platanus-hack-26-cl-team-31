import { setTimeout } from "node:timers/promises"
import type { Telemetry } from "@team-31/telemetry"
import type { Context } from "hono"
import { streamSSE } from "hono/streaming"
import { TelemetryEvent, type EventFilters } from "../shared/contract.js"
import type { AdminQueries } from "../shared/queries.js"

// GET /api/admin/live: cola en vivo de ops.events por SSE. Hace poll cada segundo por
// id > cursor, manda un heartbeat cada 15 s y reanuda desde Last-Event-ID.
// Mismo patrón que apps/broker/src/http/stream.ts.

export type LiveOptions = { pollMs?: number; heartbeatMs?: number; backlog?: number; shutdown?: AbortSignal }

const PAGE = 500
const byId = (a: TelemetryEvent, b: TelemetryEvent) => {
  const delta = BigInt(a.id) - BigInt(b.id)
  return delta === 0n ? 0 : delta < 0n ? -1 : 1
}

export async function liveStream(
  c: Context,
  queries: AdminQueries,
  telemetry: Pick<Telemetry, "error">,
  filters: Omit<EventFilters, "afterId" | "beforeId" | "limit">,
  { pollMs = 1_000, heartbeatMs = 15_000, backlog = 50, shutdown }: LiveOptions = {},
) {
  const lastEventId = c.req.header("last-event-id")
  let cursor = lastEventId && /^\d{1,19}$/.test(lastEventId) ? lastEventId : undefined
  const fetchPage = async () => {
    const items = cursor
      ? await queries.events({ ...filters, afterId: cursor, limit: PAGE })
      : await queries.events({ ...filters, limit: backlog })
    return items.map((item) => TelemetryEvent.parse(item)).sort(byId)
  }
  // La primera lectura ocurre antes de abrir el stream para responder errores como JSON.
  const initial = await fetchPage()

  c.header("X-Accel-Buffering", "no")
  const response = streamSSE(c, async (stream) => {
    const disconnected = new AbortController()
    stream.onAbort(() => disconnected.abort())
    const signals = [c.req.raw.signal, disconnected.signal]
    if (shutdown) signals.push(shutdown)
    const signal = AbortSignal.any(signals)
    const abort = () => stream.abort()
    signal.addEventListener("abort", abort, { once: true })

    let items = initial
    let heartbeatAt = Date.now() + heartbeatMs
    try {
      if (signal.aborted) return
      await stream.write("retry: 1000\n\n")
      while (!signal.aborted) {
        for (const item of items) {
          if (signal.aborted) return
          await stream.writeSSE({ id: item.id, event: "telemetry", data: JSON.stringify(item) })
          cursor = item.id
        }
        if (Date.now() >= heartbeatAt) {
          await stream.write(": heartbeat\n\n")
          heartbeatAt = Date.now() + heartbeatMs
        }
        // Si la página vino llena hay más eventos pendientes: no esperes.
        if (items.length < PAGE) await setTimeout(pollMs, undefined, { signal })
        items = await fetchPage()
      }
    } catch (error) {
      // El cliente reconecta solo (retry) y retoma desde Last-Event-ID.
      if (!signal.aborted) telemetry.error("GET /api/admin/live", error)
    } finally {
      signal.removeEventListener("abort", abort)
    }
  })
  response.headers.set("Cache-Control", "no-store")
  return response
}
