import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { EraserIcon, PauseIcon, PlayIcon } from "lucide-react"
import { EventKind, Service, type TelemetryEvent } from "@shared/contract"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { EventSheet } from "@/components/event-sheet"
import {
  ClearFilters,
  FilterBar,
  SearchInput,
  SelectFilter,
} from "@/components/filters"
import { Page, PageHeader, Panel } from "@/components/page"
import { StatusDot } from "@/components/status"
import { AttrChips } from "@/components/timeline"
import {
  api,
  subscribeLive,
  type LiveFilters,
  type LiveStatus,
} from "@/lib/api"
import { formatDuration, useNow } from "@/lib/format"
import { levelTone, serviceColor, serviceLabel } from "@/lib/status"

const MAX_EVENTS = 500
const clock = new Intl.DateTimeFormat("es-CL", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
})

const statusMeta: Record<
  LiveStatus,
  { label: string; tone: "ok" | "warn" | "error" }
> = {
  connecting: { label: "Conectando", tone: "warn" },
  open: { label: "En vivo", tone: "ok" },
  error: { label: "Desconectado", tone: "error" },
}

type Level = TelemetryEvent["level"]
type Filters = {
  service?: Service
  kind?: EventKind
  level?: Level
  requestId: string
}

type StreamProps = { liveFilters: LiveFilters; filterBar: React.ReactNode }

// La cola vive en un componente con `key` por filtros: al cambiarlos se reinicia el estado
// y la suscripción, sin efectos que reseteen estado a mano.
function LiveStream({ liveFilters, filterBar }: StreamProps) {
  const now = useNow()
  const [live, setLive] = React.useState<TelemetryEvent[]>([])
  const [buffer, setBuffer] = React.useState<TelemetryEvent[]>([])
  const [showHistory, setShowHistory] = React.useState(true)
  const [paused, setPaused] = React.useState(false)
  const [status, setStatus] = React.useState<LiveStatus>("connecting")
  const [selected, setSelected] = React.useState<TelemetryEvent | null>(null)
  const [freshIds, setFreshIds] = React.useState<Set<string>>(() => new Set())
  const pausedRef = React.useRef(paused)
  React.useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Historial inicial con los mismos filtros; luego la cola en vivo.
  const history = useQuery({
    queryKey: ["events", "live-backfill", liveFilters],
    queryFn: ({ signal }) =>
      api("events", { query: { ...liveFilters, limit: 50 } }, { signal }),
    staleTime: Infinity,
    gcTime: 0,
  })

  React.useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const stop = subscribeLive(liveFilters, {
      onStatus: setStatus,
      onEvent: (event) => {
        if (pausedRef.current) {
          setBuffer((prev) => [event, ...prev].slice(0, MAX_EVENTS))
          return
        }
        setLive((prev) => [event, ...prev].slice(0, MAX_EVENTS))
        setFreshIds((prev) => new Set(prev).add(event.id))
        const timer = setTimeout(() => {
          timers.delete(timer)
          setFreshIds((prev) => {
            const next = new Set(prev)
            next.delete(event.id)
            return next
          })
        }, 1_200)
        timers.add(timer)
      },
    })
    return () => {
      stop()
      for (const timer of timers) clearTimeout(timer)
    }
  }, [liveFilters])

  function resume() {
    setLive((prev) => [...buffer, ...prev].slice(0, MAX_EVENTS))
    setBuffer([])
    setPaused(false)
  }

  function clear() {
    setLive([])
    setBuffer([])
    setShowHistory(false)
  }

  const events = React.useMemo(
    () =>
      (showHistory ? [...live, ...(history.data?.items ?? [])] : live).slice(
        0,
        MAX_EVENTS
      ),
    [live, history.data, showHistory]
  )
  const perMinute = live.filter((e) => Date.parse(e.at) >= now - 60_000).length
  const meta = statusMeta[status]

  return (
    <Page>
      <PageHeader
        title="En vivo"
        description="Cola de ops.events en tiempo real (SSE). Máximo 500 eventos en pantalla."
        actions={
          <>
            <Badge variant="outline" className="h-7 gap-2 px-2.5">
              <StatusDot
                tone={paused ? "warn" : meta.tone}
                live={!paused && status === "open"}
              />
              {paused ? "En pausa" : meta.label}
              <span className="font-mono text-muted-foreground tabular-nums">
                {perMinute}/min
              </span>
            </Badge>
            {paused ? (
              <Button size="sm" onClick={resume}>
                <PlayIcon data-icon="inline-start" />
                Reanudar
                {buffer.length ? (
                  <span className="font-mono tabular-nums">
                    +{buffer.length}
                  </span>
                ) : null}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPaused(true)}
              >
                <PauseIcon data-icon="inline-start" />
                Pausar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={clear}>
              <EraserIcon data-icon="inline-start" />
              Limpiar
            </Button>
          </>
        }
      />
      {filterBar}
      <Panel>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-28 pl-4 text-xs font-normal text-muted-foreground">
                Hora
              </TableHead>
              <TableHead className="h-8 text-xs font-normal text-muted-foreground">
                Servicio
              </TableHead>
              <TableHead className="h-8 text-xs font-normal text-muted-foreground">
                Evento
              </TableHead>
              <TableHead className="hidden h-8 text-xs font-normal text-muted-foreground lg:table-cell">
                Atributos
              </TableHead>
              <TableHead className="hidden h-8 text-xs font-normal text-muted-foreground md:table-cell">
                Solicitud
              </TableHead>
              <TableHead className="h-8 pr-4 text-right text-xs font-normal text-muted-foreground">
                Duración
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {history.isPending
                    ? "Cargando historial…"
                    : "Esperando eventos…"}
                </TableCell>
              </TableRow>
            ) : null}
            {events.map((event) => (
              <TableRow
                key={event.id}
                className={cn(
                  "cursor-pointer",
                  freshIds.has(event.id) &&
                    "animate-in bg-muted/40 duration-500 fade-in-0 slide-in-from-top-1"
                )}
                onClick={() => setSelected(event)}
              >
                <TableCell className="py-1 pl-4 font-mono text-xs text-muted-foreground tabular-nums">
                  {clock.format(new Date(event.at))}
                </TableCell>
                <TableCell className="py-1">
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <span
                      className="size-1.5 rounded-[1px]"
                      style={{ background: serviceColor[event.service] }}
                    />
                    {serviceLabel[event.service]}
                  </span>
                </TableCell>
                <TableCell className="py-1">
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone={levelTone[event.level]} small />
                    <span
                      className={cn(
                        "font-mono text-xs",
                        event.level === "error" && "text-status-error",
                        event.level === "warn" && "text-status-warn"
                      )}
                    >
                      {event.name}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden w-full max-w-0 py-1 lg:table-cell">
                  <AttrChips
                    attrs={event.attrs}
                    className="flex-nowrap overflow-hidden"
                  />
                </TableCell>
                <TableCell className="hidden py-1 font-mono text-xs text-muted-foreground md:table-cell">
                  {event.requestId ?? "—"}
                </TableCell>
                <TableCell className="py-1 pr-4 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {formatDuration(event.durationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <EventSheet
        event={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </Page>
  )
}

export function LivePage() {
  const [filters, setFilters] = React.useState<Filters>({ requestId: "" })
  const liveFilters = React.useMemo<LiveFilters>(
    () => ({
      service: filters.service,
      kind: filters.kind,
      level: filters.level,
      requestId: filters.requestId || undefined,
    }),
    [filters]
  )
  const active =
    !!filters.service ||
    !!filters.kind ||
    !!filters.level ||
    !!filters.requestId
  const onRequestId = React.useCallback(
    (requestId: string) => setFilters((f) => ({ ...f, requestId })),
    []
  )
  const filterBar = (
    <FilterBar>
      <SelectFilter
        label="Servicio"
        allLabel="Todos los servicios"
        options={Service.options}
        value={filters.service}
        onChange={(service) => setFilters((f) => ({ ...f, service }))}
        renderOption={(s) => serviceLabel[s]}
      />
      <SelectFilter
        label="Tipo"
        allLabel="Todos los tipos"
        options={EventKind.options}
        value={filters.kind}
        onChange={(kind) => setFilters((f) => ({ ...f, kind }))}
      />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={filters.level ?? "all"}
        onValueChange={(value) =>
          setFilters((f) => ({
            ...f,
            level: value && value !== "all" ? (value as Level) : undefined,
          }))
        }
        aria-label="Nivel"
      >
        <ToggleGroupItem value="all">Todos</ToggleGroupItem>
        <ToggleGroupItem value="info">info</ToggleGroupItem>
        <ToggleGroupItem value="warn">warn</ToggleGroupItem>
        <ToggleGroupItem value="error">error</ToggleGroupItem>
      </ToggleGroup>
      <SearchInput
        label="Request id"
        placeholder="Request id exacto"
        mono
        value={filters.requestId}
        onChange={onRequestId}
      />
      <ClearFilters
        visible={active}
        onClear={() => setFilters({ requestId: "" })}
      />
    </FilterBar>
  )
  return (
    <LiveStream
      key={JSON.stringify(liveFilters)}
      liveFilters={liveFilters}
      filterBar={filterBar}
    />
  )
}
