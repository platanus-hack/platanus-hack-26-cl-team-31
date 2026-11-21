import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router"
import {
  AgentFlow,
  createFlowDirectory,
  createTelemetryMapper,
  flowEventNames,
  type FlowEvent,
} from "@team-31/agent-flow"
import type { TelemetryEvent } from "@shared/contract"

import { Badge } from "@/components/ui/badge"
import { Page, PageHeader } from "@/components/page"
import { StatusDot } from "@/components/status"
import { api, subscribeLive, type LiveStatus } from "@/lib/api"

// Flujo en vivo: la misma cola SSE de /api/admin/live (sesión de admin, rol viewer) dibujada como
// grafo con @team-31/agent-flow. Solo usa lecturas redactadas que el admin ya expone: eventos de
// ops.events, direcciones de RequestSummary, nombres de Personas y etiquetas de Agentes.

const MAX_EVENTS = 2_000
// Eventos anteriores a abrir la página que llegan en el backlog del SSE: se ignoran.
const BACKLOG_MS = 30_000
// Una fila espera hasta esto a que llegue el resumen de su solicitud.
const REQUEST_WAIT_MS = 2_500

const statusMeta: Record<LiveStatus, { label: string; tone: "ok" | "warn" | "error" }> = {
  connecting: { label: "Conectando", tone: "warn" },
  open: { label: "En vivo", tone: "ok" },
  error: { label: "Desconectado", tone: "error" },
}

// Paleta del grafo con los tokens semánticos del admin (claro y oscuro).
const theme = {
  "--af-bg": "var(--background)",
  "--af-surface": "var(--card)",
  "--af-raised": "var(--muted)",
  "--af-line": "var(--border)",
  "--af-line-strong": "color-mix(in oklch, var(--foreground) 22%, transparent)",
  "--af-ink": "var(--foreground)",
  "--af-body": "var(--muted-foreground)",
  "--af-muted": "var(--muted-foreground)",
  "--af-accent": "var(--status-info)",
  "--af-info": "var(--status-info)",
  "--af-ok": "var(--status-ok)",
  "--af-warn": "var(--status-warn)",
  "--af-danger": "var(--status-error)",
  "--af-mono": "var(--font-mono)",
} as React.CSSProperties

type Pending = { row: TelemetryEvent; arrived: number }

export function FlowPage() {
  const [params] = useSearchParams()
  const defaultOwners = React.useMemo(
    () =>
      (params.get("titulares") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [params]
  )
  const [status, setStatus] = React.useState<LiveStatus>("connecting")
  const [events, setEvents] = React.useState<FlowEvent[]>([])

  const users = useQuery({
    queryKey: ["users", "flow"],
    queryFn: ({ signal }) => api("users", { query: { limit: 200 } }, { signal }),
    staleTime: 60_000,
  })
  const agents = useQuery({
    queryKey: ["agents", "flow"],
    queryFn: ({ signal }) => api("agents", {}, { signal }),
    staleTime: 60_000,
  })

  const directory = React.useMemo(() => createFlowDirectory(), [])
  const mapper = React.useMemo(() => createTelemetryMapper(directory), [directory])
  const ready = !users.isPending && !agents.isPending

  React.useEffect(() => {
    directory.add({
      users: (users.data?.items ?? []).map((user) => ({
        userId: user.userId,
        address: user.address,
        displayName: user.displayName,
      })),
      agents: (agents.data?.items ?? []).map((agent) => ({
        agentId: agent.agentId,
        userId: agent.userId,
        label: agent.label,
        kind: agent.wakeKind,
        revokedAt: agent.revokedAt,
      })),
    })
  }, [directory, users.data, agents.data])

  const queue = React.useRef<Pending[]>([])
  const requests = React.useRef(new Map<string, "loading" | "done">())
  const readyRef = React.useRef(ready)
  React.useEffect(() => {
    readyRef.current = ready
  }, [ready])

  React.useEffect(() => {
    const openedAt = Date.now()
    const controller = new AbortController()
    const lookup = (id: string) => {
      if (requests.current.has(id)) return
      requests.current.set(id, "loading")
      api("request", { params: { id } }, { signal: controller.signal })
        .then(({ summary }) =>
          directory.add({
            requests: [
              {
                id: summary.id,
                fromAddress: summary.fromAddress,
                toAddress: summary.toAddress,
                targetAgentId: summary.targetAgentId,
                answeredByAgentId: summary.answeredByAgentId,
              },
            ],
          })
        )
        // Sin resumen el grafo usa los ids del evento: el paso se dibuja igual.
        .catch(() => undefined)
        .finally(() => requests.current.set(id, "done"))
    }

    const stop = subscribeLive(
      {},
      {
        onStatus: setStatus,
        onEvent: (row) => {
          if (!flowEventNames.has(row.name)) return
          if (Date.parse(row.at) < openedAt - BACKLOG_MS) return
          if (row.requestId) lookup(row.requestId)
          queue.current.push({ row, arrived: Date.now() })
        },
      }
    )

    // Entrega en orden de llegada; una fila espera el resumen de su solicitud (o REQUEST_WAIT_MS).
    let snapshotDone = false
    const timer = setInterval(() => {
      if (!readyRef.current) return
      // Foto inicial de la red (Personas y Agentes) antes del primer evento en vivo.
      if (!snapshotDone) {
        snapshotDone = true
        const snapshot = mapper.snapshot(Date.now())
        if (snapshot.length > 0) setEvents((previous) => [...snapshot, ...previous])
      }
      if (queue.current.length === 0) return
      const mapped: FlowEvent[] = []
      const now = Date.now()
      while (queue.current.length > 0) {
        const { row, arrived } = queue.current[0]!
        const waiting =
          row.requestId &&
          requests.current.get(row.requestId) === "loading" &&
          now - arrived < REQUEST_WAIT_MS
        if (waiting) break
        queue.current.shift()
        mapped.push(...mapper.map(row))
      }
      if (mapped.length > 0) {
        setEvents((previous) => {
          const next = [...previous, ...mapped]
          return next.length > MAX_EVENTS ? mapped : next
        })
      }
    }, 250)

    return () => {
      stop()
      controller.abort()
      clearInterval(timer)
    }
  }, [directory, mapper])

  const meta = statusMeta[status]
  return (
    <Page>
      <PageHeader
        title="Flujo"
        description="Conversaciones entre agentes en tiempo real: preguntas, política, avisos, respuestas saneadas y entregas. Solo metadatos redactados de ops.events."
      />
      <div style={theme}>
        <AgentFlow
          mode="live"
          events={events}
          defaultOwners={defaultOwners}
          title="Flujo en vivo entre agentes"
          emptyText={
            ready
              ? "Esperando una solicitud. Lanza el escenario con pnpm agents:runtime-demo."
              : "Cargando personas y agentes…"
          }
          toolbar={
            <Badge variant="outline" className="h-7 gap-2 px-2.5">
              <StatusDot tone={meta.tone} live={status === "open"} />
              {meta.label}
            </Badge>
          }
        />
      </div>
    </Page>
  )
}
