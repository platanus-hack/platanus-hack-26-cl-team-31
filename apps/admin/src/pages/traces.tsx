import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, BugIcon, InboxIcon, SearchIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"
import type { Trace } from "@shared/contract"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyButton, CopyId } from "@/components/copy-id"
import {
  QueryError,
  KeyValues,
  Muted,
  Page,
  PageHeader,
  Panel,
} from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { StatusDot } from "@/components/status"
import { AttrChips } from "@/components/timeline"
import { api } from "@/lib/api"
import { formatAbsolute, formatDuration } from "@/lib/format"
import { traceQuery } from "@/lib/queries"
import { serviceColor, serviceLabel } from "@/lib/status"

type Span = Trace["spans"][number]
type Row = Span & { depth: number; start: number; end: number }

function layout(spans: Span[]): { rows: Row[]; t0: number; total: number } {
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
  const t0 = Math.min(...rows.map((r) => r.start))
  const total = Math.max(1, Math.max(...rows.map((r) => r.end)) - t0)
  return { rows, t0, total }
}

const isError = (span: Span) =>
  span.level === "error" || span.status === "error" || span.errorId !== null

function Waterfall({
  trace,
  selected,
  onSelect,
}: {
  trace: Trace
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { rows, t0, total } = React.useMemo(() => layout(trace.spans), [trace])
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="sm:min-w-[640px]">
        <div className="grid grid-cols-[9rem_1fr] border-b text-[11px] text-muted-foreground sm:grid-cols-[minmax(12rem,34%)_1fr]">
          <div className="px-3 py-1.5">Span</div>
          <div className="relative h-7">
            {ticks.map((t) => (
              <span
                key={t}
                className={cn(
                  "absolute top-1.5 font-mono whitespace-nowrap tabular-nums",
                  t === 1
                    ? "-translate-x-full pr-2"
                    : t > 0 && "-translate-x-1/2",
                  (t === 0.25 || t === 0.75) && "hidden sm:inline"
                )}
                style={{ left: `${t * 100}%` }}
              >
                {t === 0 ? "0" : formatDuration(total * t)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[9rem] grid grid-cols-4 sm:left-[34%]">
            {ticks.slice(1).map((t) => (
              <span
                key={t}
                className="border-r border-dashed border-border/60 last:border-r-0"
              />
            ))}
          </div>
          {rows.map((row) => {
            const left = ((row.start - t0) / total) * 100
            const width = Math.max(0.4, ((row.end - row.start) / total) * 100)
            const error = isError(row)
            return (
              <button
                key={row.spanId}
                type="button"
                onClick={() => onSelect(row.spanId)}
                className={cn(
                  "grid w-full grid-cols-[9rem_1fr] items-center text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted/60 sm:grid-cols-[minmax(12rem,34%)_1fr]",
                  selected === row.spanId && "bg-muted"
                )}
              >
                <span
                  className="flex min-w-0 items-center gap-1.5 py-1.5 pr-2"
                  style={{ paddingLeft: `${0.75 + row.depth * 0.7}rem` }}
                >
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: serviceColor[row.service] }}
                  />
                  <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
                    {serviceLabel[row.service]}
                  </span>
                  <span
                    className={cn(
                      "truncate font-mono",
                      error && "text-status-error"
                    )}
                  >
                    {row.name}
                  </span>
                </span>
                <span className="relative h-7">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px]",
                          error && "ring-2 ring-status-error"
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: serviceColor[row.service],
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="flex flex-col gap-0.5 font-mono">
                      <span>{row.name}</span>
                      <span>
                        {serviceLabel[row.service]} ·{" "}
                        {formatDuration(row.durationMs)} · +
                        {formatDuration(row.start - t0)}
                      </span>
                      {row.status ? <span>status {row.status}</span> : null}
                    </TooltipContent>
                  </Tooltip>
                  <span
                    className={cn(
                      "pointer-events-none absolute top-1/2 -translate-y-1/2 px-1.5 font-mono text-[11px] whitespace-nowrap",
                      // Barras largas: la duración va dentro, al final de la barra.
                      width > 25
                        ? "font-medium text-background"
                        : "text-muted-foreground"
                    )}
                    style={
                      width > 25
                        ? { right: `${100 - left - width}%` }
                        : left + width > 85
                          ? { right: `${100 - left}%` }
                          : { left: `${left + width}%` }
                    }
                  >
                    {formatDuration(row.durationMs)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SpanDetail({ span }: { span: Span }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
          <span
            className="size-2.5 rounded-[2px]"
            style={{ background: serviceColor[span.service] }}
          />
          {span.name}
        </CardTitle>
        <CardDescription className="text-xs">
          {serviceLabel[span.service]} · {formatAbsolute(span.startAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <KeyValues
          className="lg:grid-cols-4"
          items={[
            { label: "Span", value: <CopyId value={span.spanId} max={18} /> },
            {
              label: "Padre",
              value: span.parentSpanId ? (
                <CopyId value={span.parentSpanId} max={18} />
              ) : (
                <Muted>Raíz</Muted>
              ),
            },
            {
              label: "Duración",
              value: (
                <span className="font-mono text-xs">
                  {formatDuration(span.durationMs)}
                </span>
              ),
            },
            {
              label: "Status",
              value: (
                <span className="font-mono text-xs">{span.status ?? "—"}</span>
              ),
            },
            {
              label: "Solicitud",
              value: span.requestId ? (
                <CopyId
                  value={span.requestId}
                  to={`/solicitudes/${span.requestId}`}
                />
              ) : (
                <Muted />
              ),
            },
            {
              label: "Error",
              value: span.errorId ? (
                <Link
                  to={`/errores/${span.errorId}`}
                  className="inline-flex items-center gap-1 font-mono text-xs text-status-error hover:underline"
                >
                  <BugIcon className="size-3" />
                  {span.errorId.slice(0, 8)}…
                </Link>
              ) : (
                <Muted />
              ),
            },
          ]}
        />
        <AttrChips attrs={span.attrs} />
      </CardContent>
    </Card>
  )
}

export function TraceDetailPage() {
  const { id = "" } = useParams()
  const query = useQuery(traceQuery(id))
  const [selected, setSelected] = React.useState<string | null>(null)
  const trace = query.data
  const summary = React.useMemo(() => {
    if (!trace || trace.spans.length === 0) return null
    const { rows, total } = layout(trace.spans)
    return {
      total,
      services: [...new Set(rows.map((r) => r.service))],
      errors: rows.filter(isError).length,
      requestId: rows.find((r) => r.requestId)?.requestId ?? null,
      startAt: rows[0]!.startAt,
    }
  }, [trace])
  const selectedSpan = trace?.spans.find((s) => s.spanId === selected) ?? null

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Traza{" "}
            <span className="font-mono text-sm font-normal text-muted-foreground sm:text-base">
              {id}
            </span>
            <CopyButton value={id} />
          </span>
        }
        description={
          summary ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-foreground">
                {formatDuration(summary.total)}
              </span>
              ·<span>{trace?.spans.length} spans</span>·
              <span className="flex items-center gap-1.5">
                {summary.services.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="gap-1 font-mono text-[11px]"
                  >
                    <span
                      className="size-1.5 rounded-[1px]"
                      style={{ background: serviceColor[s] }}
                    />
                    {serviceLabel[s]}
                  </Badge>
                ))}
              </span>
              {summary.errors ? (
                <span className="text-status-error">
                  · {summary.errors} con error
                </span>
              ) : null}
              ·<RelativeTime value={summary.startAt} />
            </span>
          ) : null
        }
        actions={
          summary?.requestId ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/solicitudes/${summary.requestId}`}>
                <InboxIcon data-icon="inline-start" />
                Ver solicitud
              </Link>
            </Button>
          ) : null
        }
      />
      <QueryError query={query} />
      {query.isPending ? <Skeleton className="h-96" /> : null}
      {trace ? (
        <>
          <Panel
            title="Cascada"
            description="Spans de todos los servicios, alineados en el tiempo. Haz clic en uno para ver sus atributos."
          >
            <Waterfall
              trace={trace}
              selected={selected}
              onSelect={setSelected}
            />
          </Panel>
          {selectedSpan ? <SpanDetail span={selectedSpan} /> : null}
        </>
      ) : null}
    </Page>
  )
}

export function TracesPage() {
  const navigate = useNavigate()
  const [value, setValue] = React.useState("")
  const recent = useQuery({
    queryKey: ["events", { recentTraces: true }],
    queryFn: ({ signal }) =>
      api("events", { query: { limit: 300 } }, { signal }),
    staleTime: 15_000,
  })
  const traces = React.useMemo(() => {
    const map = new Map<
      string,
      {
        traceId: string
        at: string
        services: Set<string>
        events: number
        errors: number
        requestId: string | null
        name: string
      }
    >()
    for (const e of recent.data?.items ?? []) {
      if (!e.traceId) continue
      const entry = map.get(e.traceId) ?? {
        traceId: e.traceId,
        at: e.at,
        services: new Set(),
        events: 0,
        errors: 0,
        requestId: e.requestId,
        name: e.name,
      }
      entry.services.add(e.service)
      entry.events += 1
      if (e.level === "error" || e.errorId) entry.errors += 1
      if (e.at < entry.at) {
        entry.at = e.at
        entry.name = e.name
      }
      map.set(e.traceId, entry)
    }
    return [...map.values()]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 25)
  }, [recent.data])

  return (
    <Page>
      <PageHeader
        title="Trazas"
        description="Abre una traza por su id (encabezado X-Trace-Id o traceparent) para verla en cascada entre servicios."
      />
      <form
        className="max-w-xl"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim()) navigate(`/trazas/${value.trim()}`)
        }}
      >
        <Field>
          <InputGroup className="h-9">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Trace id"
              placeholder="4bf92f3577b34da6a3ce929d0e0e4736"
              className="font-mono text-xs"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <Button type="submit" size="xs" disabled={!value.trim()}>
                Abrir
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription className="text-xs">
            32 caracteres hexadecimales.
          </FieldDescription>
        </Field>
      </form>
      <Panel
        title="Trazas recientes"
        description="Derivadas de los últimos eventos de telemetría"
      >
        {recent.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : recent.isError ? (
          <QueryError query={recent} className="m-3 w-auto" />
        ) : (
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 pl-4 text-xs font-normal text-muted-foreground">
                  Traza
                </TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">
                  Primer evento
                </TableHead>
                <TableHead className="hidden h-8 text-xs font-normal text-muted-foreground md:table-cell">
                  Servicios
                </TableHead>
                <TableHead className="hidden h-8 text-xs font-normal text-muted-foreground sm:table-cell">
                  Solicitud
                </TableHead>
                <TableHead className="h-8 pr-4 text-right text-xs font-normal text-muted-foreground">
                  Inicio
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((t) => (
                <TableRow
                  key={t.traceId}
                  className="cursor-pointer"
                  onClick={() => navigate(`/trazas/${t.traceId}`)}
                >
                  <TableCell className="py-1.5 pl-4">
                    <span className="flex items-center gap-1.5">
                      {t.errors ? (
                        <StatusDot tone="error" small />
                      ) : (
                        <StatusDot tone="ok" small />
                      )}
                      <CopyId
                        value={t.traceId}
                        to={`/trazas/${t.traceId}`}
                        max={16}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
                    {t.name}
                  </TableCell>
                  <TableCell className="hidden py-1.5 md:table-cell">
                    <span className="flex gap-1">
                      {[...t.services].map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="gap-1 font-mono text-[11px]"
                        >
                          <span
                            className="size-1.5 rounded-[1px]"
                            style={{
                              background:
                                serviceColor[s as keyof typeof serviceColor],
                            }}
                          />
                          {serviceLabel[s as keyof typeof serviceLabel]}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="hidden py-1.5 sm:table-cell">
                    {t.requestId ? (
                      <CopyId
                        value={t.requestId}
                        to={`/solicitudes/${t.requestId}`}
                      />
                    ) : (
                      <Muted />
                    )}
                  </TableCell>
                  <TableCell className="py-1.5 pr-4 text-right text-muted-foreground">
                    <RelativeTime value={t.at} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </Page>
  )
}
