import { setTimeout } from "node:timers/promises"
import type { Telemetry } from "@team-31/telemetry"
import type { Context } from "hono"
import { streamSSE, type SSEStreamingApi } from "hono/streaming"
import { TelemetryEvent, type EventFilters } from "../shared/contract.js"
import type { AdminQueries } from "../shared/queries.js"
import { AdminHttpError } from "./errors.js"

// Colas en vivo de ops.events por SSE: GET /api/admin/live (todo, con los filtros de EventFilters)
// y GET /api/admin/flow/live (solo los eventos que dibuja la página Flujo, con attrs recortados).
// Mismo patrón que apps/broker/src/http/stream.ts, con estas garantías:
//
// - Orden y reanudación: cada mensaje lleva id = ops.events.id; el cliente reconecta con
//   Last-Event-ID (o ?after= en la primera conexión) y sigue desde ahí.
// - Escrituras que confirman tarde: los ids se asignan al insertar, pero los lotes de cada servicio
//   confirman en cualquier orden, así que un id menor puede aparecer después de uno mayor. Cada
//   lectura vuelve a pedir los últimos `lookbackMs` y descarta lo ya enviado.
// - Huecos grandes: si al reanudar faltan más de `maxCatchUp` ids, manda "reset" con el último id
//   y sigue desde ahí; el cliente decide (la página Flujo pide otra foto).
// - Contrapresión: cada escritura espera al cliente. Un cliente que no lee en `writeTimeoutMs` se
//   corta (el navegador reconecta y retoma). Máximo `maxStreams` conexiones por admin.
// - Observabilidad: admin.live.opened y admin.live.closed (motivo, enviados, duración).

export type LiveOptions = {
  pollMs?: number
  heartbeatMs?: number
  // Sin cursor: cuántos eventos recientes manda al abrir (solo /live).
  backlog?: number
  lookbackMs?: number
  maxCatchUp?: number
  writeTimeoutMs?: number
  maxStreams?: number
  shutdown?: AbortSignal
}

export type LiveSpec = {
  stream: "events" | "flow"
  principalId: string
  filters: Omit<EventFilters, "afterId" | "beforeId" | "limit"> & { names?: readonly string[] }
  // Cursor de la primera conexión. Last-Event-ID gana.
  after?: string
  // Sin cursor: true manda el backlog; false empieza en el último id.
  backlog: boolean
  // Descarta filas (además del filtro SQL) y recorta lo que sale.
  accept?: (event: TelemetryEvent) => boolean
  project?: (event: TelemetryEvent) => TelemetryEvent
  // Mensajes que deben llegar antes de una página (p. ej. el resumen de cada solicitud nueva).
  prelude?: (events: TelemetryEvent[]) => Promise<{ event: string; data: unknown }[]>
}

const PAGE = 500
const CURSOR = /^\d{1,19}$/

const byId = (a: TelemetryEvent, b: TelemetryEvent) => {
  const delta = BigInt(a.id) - BigInt(b.id)
  return delta === 0n ? 0 : delta < 0n ? -1 : 1
}

export type LiveSlots = Map<string, number>
export const createLiveSlots = (): LiveSlots => new Map()

export async function liveStream(
  c: Context,
  queries: AdminQueries,
  telemetry: Pick<Telemetry, "error" | "emit">,
  slots: LiveSlots,
  spec: LiveSpec,
  {
    pollMs = 1_000,
    heartbeatMs = 15_000,
    backlog = 50,
    lookbackMs = 3_000,
    maxCatchUp = 50_000,
    writeTimeoutMs = 30_000,
    maxStreams = 6,
    shutdown,
  }: LiveOptions = {},
) {
  // Un proceso que se está apagando (deploy, reinicio) sigue atendiendo las conexiones keep-alive
  // que ya tenía: rechazar con Connection: close obliga al navegador a reconectar en uno nuevo.
  if (shutdown?.aborted) {
    c.header("Connection", "close")
    throw new AdminHttpError("upstream", "El admin se está reiniciando. Vuelve a conectar.")
  }
  const open = slots.get(spec.principalId) ?? 0
  if (open >= maxStreams) {
    throw new AdminHttpError("rate_limited", `Ya tienes ${maxStreams} conexiones en vivo abiertas.`, { retryAfter: 5 })
  }

  const lastEventId = c.req.header("last-event-id")
  const resumeFrom = lastEventId && CURSOR.test(lastEventId) ? lastEventId : spec.after
  let cursor = resumeFrom
  let reset = false
  // La primera lectura ocurre antes de abrir el stream para responder errores como JSON.
  const latest = await queries.latestEventId()
  if (cursor && latest && BigInt(latest) - BigInt(cursor) > BigInt(maxCatchUp)) {
    cursor = latest
    reset = true
  }
  if (!cursor && !spec.backlog) cursor = latest ?? "0"

  // Ids enviados que siguen dentro de la ventana de relectura, y el cursor al inicio de cada lectura.
  const sent = new Set<string>()
  const marks: { t: number; cursor: string | undefined }[] = []
  let lastPageFull = false
  const floor = (now: number) => {
    while (marks.length > 1 && marks[1]!.t <= now - lookbackMs) marks.shift()
    return marks[0]?.cursor
  }
  const fetchPage = async () => {
    const now = Date.now()
    marks.push({ t: now, cursor })
    // Una página llena significa que hay más: se avanza desde el cursor sin releer.
    const low = floor(now)
    const from = lastPageFull ? cursor : low
    const rows = from
      ? await queries.events({ ...spec.filters, afterId: from, limit: PAGE })
      : await queries.events({ ...spec.filters, limit: backlog })
    lastPageFull = Boolean(from) && rows.length >= PAGE
    const fresh = rows.map((row) => TelemetryEvent.parse(row)).filter((row) => !sent.has(row.id)).sort(byId)
    // El piso solo avanza: lo que quedó debajo no se vuelve a leer.
    if (low) for (const id of sent) if (BigInt(id) <= BigInt(low)) sent.delete(id)
    return fresh
  }
  const initial = await fetchPage()

  slots.set(spec.principalId, open + 1)
  const startedAt = Date.now()
  let delivered = 0
  let reason: "client" | "shutdown" | "error" | "stalled" = "client"
  telemetry.emit("admin.live.opened", {
    userId: spec.principalId,
    attrs: { stream: spec.stream, resumed: Boolean(resumeFrom), reset },
  })

  c.header("X-Accel-Buffering", "no")
  const response = streamSSE(c, async (stream) => {
    const disconnected = new AbortController()
    stream.onAbort(() => disconnected.abort())
    const signals = [c.req.raw.signal, disconnected.signal]
    if (shutdown) signals.push(shutdown)
    const signal = AbortSignal.any(signals)
    const abort = () => stream.abort()
    signal.addEventListener("abort", abort, { once: true })

    // Una escritura que no termina en writeTimeoutMs es un cliente que no lee: se corta.
    const write = async (fn: (s: SSEStreamingApi) => Promise<unknown>) => {
      const timer = new AbortController()
      const stalled = setTimeout(writeTimeoutMs, "stalled" as const, { signal: AbortSignal.any([timer.signal, signal]) }).catch(() => undefined)
      const result = await Promise.race([fn(stream).then(() => "ok" as const), stalled])
      timer.abort()
      if (result === "stalled") {
        reason = "stalled"
        disconnected.abort()
        throw new Error("stalled")
      }
    }

    let items = initial
    let heartbeatAt = Date.now() + heartbeatMs
    try {
      if (signal.aborted) return
      await write((s) => s.write("retry: 1000\n\n"))
      if (reset) await write((s) => s.writeSSE({ id: cursor, event: "reset", data: JSON.stringify({ cursor: cursor ?? null }) }))
      while (!signal.aborted) {
        const outgoing = spec.accept ? items.filter(spec.accept) : items
        if (outgoing.length > 0 && spec.prelude) {
          for (const message of await spec.prelude(outgoing)) {
            await write((s) => s.writeSSE({ event: message.event, data: JSON.stringify(message.data) }))
          }
        }
        for (const item of items) {
          if (signal.aborted) return
          sent.add(item.id)
          if (cursor === undefined || BigInt(item.id) > BigInt(cursor)) cursor = item.id
          if (spec.accept && !spec.accept(item)) continue
          const data = spec.project ? spec.project(item) : item
          await write((s) => s.writeSSE({ id: item.id, event: "telemetry", data: JSON.stringify(data) }))
          delivered++
        }
        if (Date.now() >= heartbeatAt) {
          await write((s) => s.write(": heartbeat\n\n"))
          heartbeatAt = Date.now() + heartbeatMs
        }
        if (!lastPageFull) await setTimeout(pollMs, undefined, { signal })
        items = await fetchPage()
      }
    } catch (error) {
      // El cliente reconecta solo (retry) y retoma desde Last-Event-ID.
      if (signal.aborted) {
        if (reason !== "stalled" && shutdown?.aborted) reason = "shutdown"
      } else {
        reason = "error"
        telemetry.error(`GET ${c.req.routePath}`, error, { userId: spec.principalId })
      }
    } finally {
      signal.removeEventListener("abort", abort)
      const remaining = (slots.get(spec.principalId) ?? 1) - 1
      if (remaining > 0) slots.set(spec.principalId, remaining)
      else slots.delete(spec.principalId)
      telemetry.emit("admin.live.closed", {
        userId: spec.principalId,
        durationMs: Date.now() - startedAt,
        attrs: { stream: spec.stream, reason, delivered },
      })
    }
  })
  response.headers.set("Cache-Control", "no-store")
  return response
}
