// Estado del flujo en vivo de la página Flujo. Une la foto de la red (/api/admin/flow/snapshot)
// con el stream filtrado (/api/admin/flow/live) y entrega FlowEvent[] al renderer:
//
// - Foto + cursor: el stream empieza en el último id de ops.events al tomar la foto, así no hay
//   hueco entre «quién está» y «qué pasa».
// - Duplicados y orden: createLiveFeed descarta ids repetidos y reordena por momento de ocurrencia
//   dentro de una ventana corta (spans del MCP escritos después que los eventos del broker).
// - Caídas: el navegador reintenta solo con Last-Event-ID. Si deja de reintentar (401/403/429/5xx)
//   o el servidor manda «reset», se pide otra foto: con un corte corto se retoma desde el último
//   id visto; con uno largo (o reset) desde el cursor de la foto nueva y se reconcilia la presencia.
// - Directorio: se refresca si aparece un usuario o agente desconocido (como mucho cada 5 s) y cada
//   minuto; cada refresco reconcilia la presencia (revocados salen, nuevos entran).
// - Memoria: como mucho MAX_EVENTS pasos; al pasarse se descartan los más viejos (el renderer
//   conserva el estado) y el mapeo acota sus propias tablas.
import * as React from "react"
import {
  compareIds,
  createFlowDirectory,
  createLiveFeed,
  createTelemetryMapper,
  type FlowDirectory,
  type FlowEvent,
} from "@team-31/agent-flow"
import type { FlowRequestRef, FlowSnapshot } from "@shared/contract"

import { api, isApiError, subscribeFlow } from "@/lib/api"

export type FlowLiveStatus = "loading" | "live" | "reconnecting" | "offline"

const MAX_EVENTS = 4_000
const KEEP_EVENTS = 2_500
const HOLD_MS = 700
const TICK_MS = 200
const REFRESH_MS = 60_000
const UNKNOWN_REFRESH_MS = 5_000
// Un corte más largo que esto no se repone evento por evento: se toma otra foto.
const RESUME_GAP_MS = 60_000
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

const toRequest = (ref: FlowRequestRef) => ({
  id: ref.id,
  fromAddress: ref.fromAddress,
  toAddress: ref.toAddress,
  targetAgentId: ref.targetAgentId,
  answeredByAgentId: ref.answeredByAgentId,
})

function addSnapshot(directory: FlowDirectory, snapshot: FlowSnapshot) {
  directory.add({
    users: snapshot.users,
    agents: snapshot.agents.map((agent) => ({
      agentId: agent.agentId,
      userId: agent.userId,
      label: agent.label,
      kind: agent.wakeKind,
      revokedAt: agent.revokedAt,
    })),
    requests: snapshot.requests.map(toRequest),
  })
}

export function useFlowLive() {
  const [events, setEvents] = React.useState<FlowEvent[]>([])
  const [status, setStatus] = React.useState<FlowLiveStatus>("loading")
  const [error, setError] = React.useState<unknown>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [lastEventAt, setLastEventAt] = React.useState<number | null>(null)
  const [generation, setGeneration] = React.useState(0)

  React.useEffect(() => {
    const directory = createFlowDirectory()
    const mapper = createTelemetryMapper(directory)
    const feed = createLiveFeed(mapper, { holdMs: HOLD_MS })
    let list: FlowEvent[] = []
    let lastId: string | null = null
    let droppedAt: number | null = null
    let stop: (() => void) | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let first = true
    let disposed = false
    let refreshedAt = 0
    let refreshing = false

    const append = (next: FlowEvent[]) => {
      if (next.length === 0) return
      list = list.concat(next)
      // Ventana: el renderer detecta que se quitaron los primeros y conserva su estado.
      if (list.length > MAX_EVENTS) list = list.slice(list.length - KEEP_EVENTS)
      setEvents(list)
    }

    const refreshDirectory = async () => {
      if (refreshing) return
      refreshing = true
      refreshedAt = Date.now()
      try {
        const snapshot = await api("flowSnapshot")
        if (disposed) return
        addSnapshot(directory, snapshot)
        setTruncated(snapshot.truncated)
        append(mapper.reconcile(Date.now()))
      } catch {
        // Lo reintenta el próximo refresco; el stream sigue.
      } finally {
        refreshing = false
      }
    }

    const connect = async () => {
      clearTimeout(retry)
      stop?.()
      stop = null
      setStatus(first ? "loading" : "reconnecting")
      let snapshot: FlowSnapshot
      try {
        snapshot = await api("flowSnapshot")
      } catch (cause) {
        if (disposed) return
        setError(cause)
        // Sin sesión o sin rol no tiene sentido reintentar solo.
        if (
          isApiError(cause, "unauthorized") ||
          isApiError(cause, "forbidden")
        ) {
          setStatus("offline")
          return
        }
        setStatus(first ? "offline" : "reconnecting")
        retry = setTimeout(
          connect,
          BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
        )
        return
      }
      if (disposed) return
      setError(null)
      addSnapshot(directory, snapshot)
      setTruncated(snapshot.truncated)
      refreshedAt = Date.now()
      // Primera foto: la red completa sin animación. Después: solo las diferencias.
      append(first ? mapper.snapshot(Date.now()) : mapper.reconcile(Date.now()))
      const resume =
        lastId && droppedAt !== null && Date.now() - droppedAt < RESUME_GAP_MS
      const after = resume ? lastId : snapshot.cursor
      first = false
      droppedAt = null

      stop = subscribeFlow(after, {
        onOpen: () => {
          droppedAt = null
          attempt = 0
          setStatus("live")
        },
        onRetrying: () => {
          droppedAt ??= Date.now()
          setStatus("reconnecting")
        },
        onClosed: () => {
          droppedAt ??= Date.now()
          setStatus("reconnecting")
          retry = setTimeout(
            connect,
            BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]
          )
        },
        onRequest: (ref) => directory.add({ requests: [toRequest(ref)] }),
        onRow: (row) => {
          if (feed.push(row, Date.now())) {
            if (!lastId || compareIds(row.id, lastId) > 0) lastId = row.id
            setLastEventAt(Date.now())
          }
        },
        onReset: () => {
          // Hueco demasiado grande: otra foto desde su cursor.
          lastId = null
          droppedAt = Date.now()
          void connect()
        },
      })
    }

    const timer = setInterval(() => {
      append(feed.drain(Date.now()))
      if (first || refreshing) return
      const elapsed = Date.now() - refreshedAt
      if (elapsed <= UNKNOWN_REFRESH_MS) return
      const unknown = mapper.takeUnknown()
      if (elapsed > REFRESH_MS || unknown.users.length || unknown.agents.length) void refreshDirectory()
    }, TICK_MS)

    void connect()
    return () => {
      disposed = true
      clearInterval(timer)
      clearTimeout(retry)
      stop?.()
    }
  }, [generation])

  const reconnect = React.useCallback(() => {
    setEvents([])
    setStatus("loading")
    setError(null)
    setGeneration((value) => value + 1)
  }, [])

  return { events, status, error, truncated, lastEventAt, reconnect }
}
