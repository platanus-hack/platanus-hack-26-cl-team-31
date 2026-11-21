import * as React from "react"
import { Link, useSearchParams } from "react-router"
import { AgentFlow, type FlowEvent } from "@team-31/agent-flow"
import { RotateCwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, Page, PageHeader } from "@/components/page"
import { StatusDot } from "@/components/status"
import { useFlowLive, type FlowLiveStatus } from "@/lib/flow-live"
import { formatRelative, useNow } from "@/lib/format"

// Flujo en vivo: la red de Sideband (personas, agentes, quién entra y sale) y cada solicitud que
// cruza el broker, dibujadas con @team-31/agent-flow. Solo lecturas redactadas que el admin ya
// expone (rol viewer): /api/admin/flow/snapshot y el stream filtrado /api/admin/flow/live.
// Filtros en la URL: ?titulares=<dirección>,… y ?ocultos=agent:<id>,… (enlaces compartibles).

const statusMeta: Record<
  FlowLiveStatus,
  { label: string; tone: "ok" | "warn" | "error"; live: boolean }
> = {
  loading: { label: "Conectando", tone: "warn", live: false },
  live: { label: "En vivo", tone: "ok", live: true },
  reconnecting: { label: "Reconectando…", tone: "warn", live: false },
  offline: { label: "Sin conexión", tone: "error", live: false },
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

const list = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

function eventLinks(event: FlowEvent) {
  if (!event.requestId && !event.traceId) return null
  return (
    <>
      {event.requestId ? (
        <Link to={`/solicitudes/${encodeURIComponent(event.requestId)}`}>
          Ver solicitud
        </Link>
      ) : null}
      {event.traceId ? (
        <Link to={`/trazas/${encodeURIComponent(event.traceId)}`}>
          Ver traza
        </Link>
      ) : null}
    </>
  )
}

export function FlowPage() {
  const [params, setParams] = useSearchParams()
  // El renderer lee los filtros iniciales una vez; después los informa con onFilterChange.
  const [initial] = React.useState(() => ({
    owners: list(params.get("titulares")),
    hidden: list(params.get("ocultos")),
  }))
  const { events, status, error, truncated, lastEventAt, reconnect } =
    useFlowLive()
  const now = useNow()

  const onFilterChange = React.useCallback(
    ({
      owners,
      hiddenActors,
    }: {
      owners: string[] | null
      hiddenActors: string[]
    }) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (owners?.length) next.set("titulares", owners.join(","))
          else next.delete("titulares")
          if (hiddenActors.length) next.set("ocultos", hiddenActors.join(","))
          else next.delete("ocultos")
          return next
        },
        { replace: true }
      ),
    [setParams]
  )

  const meta = statusMeta[status]
  const loading = status === "loading" && events.length === 0
  const emptyText = loading
    ? "Cargando la red…"
    : status === "offline"
      ? "Sin conexión con el admin."
      : "Esperando actividad en la red"

  return (
    <Page>
      <PageHeader
        title="Flujo"
        description="La red y las conversaciones entre agentes en tiempo real: preguntas, política, avisos, respuestas saneadas, entregas y quién entra o sale. Solo metadatos redactados."
        actions={
          status === "offline" ? (
            <Button size="sm" variant="outline" onClick={reconnect}>
              <RotateCwIcon data-icon="inline-start" />
              Reconectar
            </Button>
          ) : null
        }
      />
      {error && status !== "live" ? (
        <ErrorState
          error={error}
          onRetry={status === "offline" ? reconnect : undefined}
        />
      ) : null}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          La red tiene más personas o agentes de los que caben en la foto
          inicial: algunos aparecerán recién cuando participen.
        </p>
      ) : null}
      <div style={theme}>
        <AgentFlow
          mode="live"
          events={events}
          defaultOwners={initial.owners}
          defaultHiddenActors={initial.hidden}
          onFilterChange={onFilterChange}
          eventActions={eventLinks}
          title="Flujo en vivo entre agentes"
          emptyText={emptyText}
          toolbar={
            <Badge
              variant="outline"
              className="h-7 gap-2 px-2.5"
              role="status"
              aria-live="polite"
              title={
                lastEventAt
                  ? `Último evento ${formatRelative(new Date(lastEventAt).toISOString(), now)}`
                  : undefined
              }
            >
              <StatusDot tone={meta.tone} live={meta.live} />
              {meta.label}
            </Badge>
          }
        />
      </div>
    </Page>
  )
}
