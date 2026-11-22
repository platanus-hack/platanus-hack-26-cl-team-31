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

import { api, isApiError, subscribeFlow, type FlowStreamHandlers } from "@/lib/api"

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

type FlowView = {
  setEvents: (events: FlowEvent[]) => void
  setStatus: (status: FlowLiveStatus) => void
  setError: (cause: unknown) => void
  setTruncated: (truncated: boolean) => void
  setLastEventAt: (at: number) => void
}

// Cada montaje o reconexión manual tiene su propio directorio, cursor y suscripción.
class FlowSession {
  private readonly view: FlowView
  private readonly directory = createFlowDirectory()
  private readonly mapper = createTelemetryMapper(this.directory)
  private readonly feed = createLiveFeed(this.mapper, { holdMs: HOLD_MS })
  private events: FlowEvent[] = []
  private first = true
  private lastId: string | null = null
  private droppedAt: number | null = null
  private attempt = 0
  private retry?: ReturnType<typeof setTimeout>
  private connection?: { controller: AbortController; stopStream?: () => void }
  private refreshedAt = 0
  private refreshing = false

  constructor(view: FlowView) {
    this.view = view
  }

  start() {
    const timer = setInterval(() => this.tick(), TICK_MS)
    void this.connect()
    return () => {
      clearInterval(timer)
      this.closeConnection()
    }
  }

  private closeConnection() {
    clearTimeout(this.retry)
    this.connection?.controller.abort()
    this.connection?.stopStream?.()
    this.connection = undefined
  }

  private append(next: FlowEvent[]) {
    if (!next.length) return
    this.events = this.events.concat(next)
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-KEEP_EVENTS)
    this.view.setEvents(this.events)
  }

  private applySnapshot(snapshot: FlowSnapshot) {
    addSnapshot(this.directory, snapshot)
    this.view.setTruncated(snapshot.truncated)
    const now = Date.now()
    this.append(this.first ? this.mapper.snapshot(now) : this.mapper.reconcile(now))
  }

  private tick() {
    const now = Date.now()
    this.append(this.feed.drain(now))
    const elapsed = now - this.refreshedAt
    if (!this.connection?.stopStream || this.refreshing || elapsed <= UNKNOWN_REFRESH_MS) return
    const unknown = this.mapper.takeUnknown()
    if (elapsed > REFRESH_MS || unknown.users.length || unknown.agents.length) {
      void this.refreshDirectory(this.connection.controller.signal)
    }
  }

  private async refreshDirectory(signal: AbortSignal) {
    this.refreshing = true
    this.refreshedAt = Date.now()
    try {
      const snapshot = await api("flowSnapshot", undefined, { signal })
      if (!signal.aborted) this.applySnapshot(snapshot)
    } catch {
      // Lo reintenta el próximo refresco mientras el stream sigue activo.
    } finally {
      this.refreshing = false
    }
  }

  private scheduleRetry() {
    const delay = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]
    clearTimeout(this.retry)
    this.retry = setTimeout(() => void this.connect(), delay)
  }

  private snapshotFailed(cause: unknown) {
    this.view.setError(cause)
    if (isApiError(cause, "unauthorized") || isApiError(cause, "forbidden")) {
      this.view.setStatus("offline")
      return
    }
    this.view.setStatus(this.first ? "offline" : "reconnecting")
    this.scheduleRetry()
  }

  private async connect() {
    this.closeConnection()
    const controller = new AbortController()
    const { signal } = controller
    this.connection = { controller }
    this.view.setStatus(this.first ? "loading" : "reconnecting")
    let snapshot: FlowSnapshot
    try {
      snapshot = await api("flowSnapshot", undefined, { signal })
    } catch (cause) {
      if (!signal.aborted) this.snapshotFailed(cause)
      return
    }
    if (signal.aborted) return
    this.view.setError(null)
    this.refreshedAt = Date.now()
    this.applySnapshot(snapshot)
    const shortGap = this.droppedAt !== null && this.refreshedAt - this.droppedAt < RESUME_GAP_MS
    const after = shortGap ? this.lastId ?? snapshot.cursor : snapshot.cursor
    this.first = false
    this.droppedAt = null
    this.connection.stopStream = subscribeFlow(after, this.handlers)
  }

  private markDisconnected() {
    this.droppedAt ??= Date.now()
    this.view.setStatus("reconnecting")
  }

  private readonly handlers: FlowStreamHandlers = {
    onOpen: () => {
      this.droppedAt = null
      this.attempt = 0
      this.view.setStatus("live")
    },
    onRetrying: () => this.markDisconnected(),
    onClosed: () => {
      this.markDisconnected()
      this.scheduleRetry()
    },
    onReset: () => {
      this.lastId = null
      void this.connect()
    },
    onRequest: (ref) => this.directory.add({ requests: [toRequest(ref)] }),
    onRow: (row) => {
      const now = Date.now()
      if (!this.feed.push(row, now)) return
      if (this.lastId === null || compareIds(row.id, this.lastId) > 0) this.lastId = row.id
      this.view.setLastEventAt(now)
    },
  }
}

export function useFlowLive() {
  const [events, setEvents] = React.useState<FlowEvent[]>([])
  const [status, setStatus] = React.useState<FlowLiveStatus>("loading")
  const [error, setError] = React.useState<unknown>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [lastEventAt, setLastEventAt] = React.useState<number | null>(null)
  const [generation, setGeneration] = React.useState(0)

  React.useEffect(() => {
    const session = new FlowSession({ setEvents, setStatus, setError, setTruncated, setLastEventAt })
    return session.start()
  }, [generation])

  const reconnect = React.useCallback(() => {
    setEvents([])
    setStatus("loading")
    setError(null)
    setGeneration((value) => value + 1)
  }, [])

  return { events, status, error, truncated, lastEventAt, reconnect }
}
