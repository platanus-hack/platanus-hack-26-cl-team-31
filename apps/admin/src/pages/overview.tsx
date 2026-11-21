import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Link, useNavigate } from "react-router"
import type {
  Overview,
  RequestSummary,
  ServiceHealth,
  Window,
} from "@shared/contract"
import type { RequestStatus } from "@team-31/protocol"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
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
import { CopyId } from "@/components/copy-id"
import { QueryError, Page, PageHeader, Panel } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { RequestStatusBadge, StatusDot } from "@/components/status"
import { api } from "@/lib/api"
import {
  formatDayTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatShortTime,
} from "@/lib/format"
import { overviewQuery } from "@/lib/queries"
import {
  healthMeta,
  requestStatusMeta,
  requestStatusOrder,
  serviceLabel,
  toneText,
  toneVar,
  toolLabel,
  wakeKindLabel,
  type Tone,
} from "@/lib/status"
import {
  useTimeWindow,
  windowMs,
  windowPhrase,
  windowTitle,
} from "@/lib/window"

// ---------- salud de servicios ----------

const healthRank: Record<ServiceHealth["state"], number> = {
  down: 0,
  stale: 1,
  up: 2,
}

function ServiceStrip({ services }: { services: ServiceHealth[] }) {
  const grouped = React.useMemo(() => {
    const map = new Map<ServiceHealth["service"], ServiceHealth[]>()
    for (const s of services)
      map.set(s.service, [...(map.get(s.service) ?? []), s])
    return [...map.entries()]
  }, [services])
  return (
    <div className="flex flex-wrap gap-2">
      {grouped.map(([service, instances]) => {
        const worst = instances.reduce((a, b) =>
          healthRank[b.state] < healthRank[a.state] ? b : a
        )
        const meta = healthMeta[worst.state]
        return (
          <Tooltip key={service}>
            <TooltipTrigger asChild>
              <div
                tabIndex={0}
                className="flex h-8 items-center gap-2 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <StatusDot tone={meta.tone} live={worst.state !== "up"} />
                <span className="font-medium">{serviceLabel[service]}</span>
                {instances.length > 1 ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    ×{instances.length}
                  </span>
                ) : null}
                {worst.state !== "up" ? (
                  <span className={cn("text-xs", toneText[meta.tone])}>
                    {meta.label.toLowerCase()}
                  </span>
                ) : null}
              </div>
            </TooltipTrigger>
            <TooltipContent className="flex flex-col gap-1">
              {instances.map((i) => (
                <span
                  key={i.instance}
                  className="flex items-center gap-2 font-mono"
                >
                  {i.instance} · v{i.version ?? "?"} ·{" "}
                  {healthMeta[i.state].label.toLowerCase()} ·{" "}
                  {formatShortTimeAgo(i.lastSeenAt)}
                </span>
              ))}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function formatShortTimeAgo(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return seconds < 90
    ? `latido hace ${seconds} s`
    : `latido hace ${Math.round(seconds / 60)} min`
}

// ---------- KPIs ----------

function Kpi({
  label,
  value,
  footer,
  tone,
  hint,
}: {
  label: string
  value: React.ReactNode
  footer: React.ReactNode
  tone?: Tone
  hint?: React.ReactNode
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardDescription className="text-xs">{label}</CardDescription>
        {hint ? <CardAction>{hint}</CardAction> : null}
        <CardTitle
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums",
            tone && toneText[tone]
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {footer}
      </CardContent>
    </Card>
  )
}

function KpiGrid({ data }: { data: Overview }) {
  const wakeTotals = data.wakes.reduce(
    (acc, w) => ({
      ok: acc.ok + w.ok,
      failed: acc.failed + w.failed,
      retried: acc.retried + w.retried,
    }),
    { ok: 0, failed: 0, retried: 0 }
  )
  const attempts = wakeTotals.ok + wakeTotals.failed
  const okRatio = attempts ? wakeTotals.ok / attempts : null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label="Solicitudes"
        value={formatNumber(data.requests.total)}
        footer={
          <span className="flex flex-wrap gap-x-2">
            <span>{data.requests.open} abiertas</span>
            <span className={data.requests.stuck ? toneText.error : undefined}>
              {data.requests.stuck} atascadas
            </span>
          </span>
        }
      />
      <Kpi
        label="p95 hasta estado final"
        value={formatDuration(data.requests.timeToFinalMs.p95)}
        footer={`p50 ${formatDuration(data.requests.timeToFinalMs.p50)}`}
      />
      <Kpi
        label="Avisos entregados"
        value={okRatio === null ? "—" : formatPercent(okRatio)}
        tone={
          okRatio === null
            ? undefined
            : okRatio < 0.9
              ? "error"
              : okRatio < 0.97
                ? "warn"
                : undefined
        }
        footer={`${formatNumber(wakeTotals.failed)} fallidos · ${formatNumber(wakeTotals.retried)} reintentos`}
      />
      <Kpi
        label="Errores"
        value={formatNumber(data.errors.total)}
        tone={data.errors.total > 0 ? "error" : undefined}
        footer={`${formatNumber(data.rateLimited)} rate limited`}
      />
    </div>
  )
}

// ---------- estados por tiempo ----------

type Series = "open" | "ok" | "neutral" | "warn" | "error"
const seriesOf: Record<RequestStatus, Series> = {
  awaiting_agent: "open",
  awaiting_owner: "open",
  answered: "ok",
  no_data: "neutral",
  declined: "warn",
  denied: "warn",
  expired: "error",
  delivery_failed: "error",
}
const chartConfig = {
  ok: { label: "Respondidas", color: toneVar.ok },
  neutral: { label: "Sin datos", color: toneVar.neutral },
  warn: { label: "Rechazadas o denegadas", color: toneVar.warn },
  error: { label: "Vencidas o fallidas", color: toneVar.error },
  open: { label: "Abiertas", color: toneVar.info },
} satisfies ChartConfig
const seriesOrder: Series[] = ["ok", "neutral", "warn", "error", "open"]

const bucketMs: Record<Window, number> = {
  "15m": 60_000,
  "1h": 5 * 60_000,
  "24h": 3_600_000,
  "7d": 12 * 3_600_000,
}

function bucketize(items: RequestSummary[], window: Window, now: number) {
  const size = bucketMs[window]
  const count = Math.round(windowMs[window] / size)
  const end = Math.ceil(now / size) * size
  const start = end - count * size
  const buckets = Array.from({ length: count }, (_, i) => ({
    t: start + i * size,
    ok: 0,
    neutral: 0,
    warn: 0,
    error: 0,
    open: 0,
  }))
  for (const r of items) {
    const index = Math.floor((Date.parse(r.createdAt) - start) / size)
    const bucket = buckets[index]
    if (bucket) bucket[seriesOf[r.status]] += 1
  }
  return buckets
}

function StatusChart({ window }: { window: Window }) {
  const [since] = React.useState(() => Date.now())
  const query = useQuery({
    queryKey: ["overview-requests", window],
    queryFn: ({ signal }) =>
      api(
        "requests",
        {
          query: {
            since: new Date(Date.now() - windowMs[window]).toISOString(),
            limit: 200,
          },
        },
        { signal }
      ),
    refetchInterval: 15_000,
  })
  const data = React.useMemo(
    () =>
      bucketize(query.data?.items ?? [], window, query.dataUpdatedAt || since),
    [query.data, query.dataUpdatedAt, window, since]
  )
  const formatTick = (t: number) =>
    window === "7d" ? formatDayTime(t) : formatShortTime(t)

  return (
    <Card size="sm" className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Solicitudes por estado</CardTitle>
        <CardDescription className="text-xs">
          Creadas en {windowPhrase[window]}, agrupadas cada{" "}
          {formatDuration(bucketMs[window])}
          {query.data?.nextCursor ? " · muestra de las 200 más recientes" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-64 flex-1 flex-col">
        {query.isPending ? (
          <Skeleton className="min-h-56 w-full flex-1" />
        ) : query.isError ? (
          <QueryError query={query} />
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto min-h-56 w-full flex-1"
          >
            <BarChart
              data={data}
              margin={{ left: -20, right: 4, top: 4 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tickFormatter={formatTick}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(_, payload) =>
                      formatTick(Number(payload?.[0]?.payload?.t))
                    }
                  />
                }
              />
              <ChartLegend
                itemSorter={(item) =>
                  seriesOrder.indexOf(item.dataKey as Series)
                }
                content={<ChartLegendContent className="flex-wrap" />}
              />
              {seriesOrder.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="status"
                  fill={`var(--color-${key})`}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={i === seriesOrder.length - 1 ? [3, 3, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBreakdown({ data }: { data: Overview }) {
  const total = Math.max(1, data.requests.total)
  const tools = Object.entries(data.requests.byTool).sort((a, b) => b[1] - a[1])
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>Desglose</CardTitle>
        <CardDescription className="text-xs">
          Por estado y por herramienta
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {requestStatusOrder.map((status) => {
          const count = data.requests.byStatus[status] ?? 0
          const meta = requestStatusMeta[status]
          return (
            <Link
              key={status}
              to={`/solicitudes?status=${status}`}
              className="group/row grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-md px-1 py-0.5 text-sm hover:bg-muted/60"
            >
              <span className="flex items-center gap-2">
                <StatusDot tone={meta.tone} small />
                <span className="truncate">{meta.label}</span>
              </span>
              <span className="font-mono text-xs tabular-nums">{count}</span>
              <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(count / total) * 100}%`,
                    background: toneVar[meta.tone],
                  }}
                />
              </span>
            </Link>
          )
        })}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {tools.map(([tool, count]) => (
          <span key={tool}>
            {toolLabel[tool as keyof typeof toolLabel] ?? tool}{" "}
            <span className="font-mono text-foreground">{count}</span>
          </span>
        ))}
      </CardFooter>
    </Card>
  )
}

// ---------- listas ----------

function StuckRequests() {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ["requests", { stuck: true, limit: 8 }],
    queryFn: ({ signal }) =>
      api("requests", { query: { stuck: true, limit: 8 } }, { signal }),
    refetchInterval: 15_000,
  })
  const items = query.data?.items ?? []
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Atascadas
          {items.length ? (
            <span className="font-mono text-xs text-muted-foreground">
              {items.length}
            </span>
          ) : null}
        </span>
      }
      description="Abiertas con el plazo vencido: el barrido no las cerró"
      action={
        <Button variant="ghost" size="xs" asChild>
          <Link to="/solicitudes?stuck=1">
            Ver todas
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      {query.isPending ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nada atascado. El barrido está al día.
        </p>
      ) : (
        <Table className="text-[13px]">
          <TableBody>
            {items.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/solicitudes/${r.id}`)}
              >
                <TableCell className="py-1.5 pl-4">
                  <CopyId value={r.id} to={`/solicitudes/${r.id}`} />
                </TableCell>
                <TableCell className="hidden py-1.5 text-muted-foreground 2xl:table-cell">
                  {toolLabel[r.tool]}
                </TableCell>
                <TableCell className="py-1.5">
                  <RequestStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="hidden py-1.5 pr-4 text-right text-muted-foreground sm:table-cell">
                  <RelativeTime value={r.createdAt} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}

function TopErrors({ data }: { data: Overview }) {
  const navigate = useNavigate()
  return (
    <Panel
      title="Errores principales"
      description="Agrupados por servicio, operación y tipo"
      action={
        <Button variant="ghost" size="xs" asChild>
          <Link to="/errores">
            Ver todos
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      {data.errors.top.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Sin errores en esta ventana.
        </p>
      ) : (
        <Table className="text-[13px]">
          <TableBody>
            {data.errors.top.map((e) => (
              <TableRow
                key={e.sampleErrorId}
                className="cursor-pointer"
                onClick={() => navigate(`/errores/${e.sampleErrorId}`)}
              >
                <TableCell className="max-w-48 py-1.5 pl-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-xs">
                      {e.operation}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {serviceLabel[e.service]}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-status-error">
                  {e.type}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">
                  ×{e.count}
                </TableCell>
                <TableCell className="hidden py-1.5 pr-4 text-right text-muted-foreground sm:table-cell">
                  <RelativeTime value={e.lastAt} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}

function WakeAdapters({ data }: { data: Overview }) {
  return (
    <Panel
      title="Avisos por adaptador"
      description="Entregas a los agentes en la ventana"
    >
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 pl-4 text-xs font-normal text-muted-foreground">
              Adaptador
            </TableHead>
            <TableHead className="h-8 w-1/3 text-xs font-normal text-muted-foreground">
              Éxito
            </TableHead>
            <TableHead className="h-8 text-right text-xs font-normal text-muted-foreground">
              OK
            </TableHead>
            <TableHead className="h-8 text-right text-xs font-normal text-muted-foreground">
              Fallidos
            </TableHead>
            <TableHead className="hidden h-8 text-right text-xs font-normal text-muted-foreground sm:table-cell">
              Reintentos
            </TableHead>
            <TableHead className="hidden h-8 pr-4 text-right text-xs font-normal text-muted-foreground sm:table-cell">
              p95
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.wakes.map((w) => {
            const total = w.ok + w.failed
            const ratio = total ? w.ok / total : 0
            const tone: Tone = !total
              ? "neutral"
              : ratio < 0.5
                ? "error"
                : ratio < 0.95
                  ? "warn"
                  : "ok"
            return (
              <TableRow key={w.kind}>
                <TableCell className="py-1.5 pl-4 font-medium">
                  {wakeKindLabel[w.kind]}
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${ratio * 100}%`,
                          background: toneVar[tone],
                        }}
                      />
                    </span>
                    <span
                      className={cn(
                        "w-12 text-right font-mono text-xs tabular-nums",
                        toneText[tone]
                      )}
                    >
                      {total ? formatPercent(ratio) : "—"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">
                  {formatNumber(w.ok)}
                </TableCell>
                <TableCell
                  className={cn(
                    "py-1.5 text-right font-mono text-xs tabular-nums",
                    w.failed > 0 && toneText.error
                  )}
                >
                  {formatNumber(w.failed)}
                </TableCell>
                <TableCell className="hidden py-1.5 text-right font-mono text-xs tabular-nums sm:table-cell">
                  {formatNumber(w.retried)}
                </TableCell>
                <TableCell className="hidden py-1.5 pr-4 text-right font-mono text-xs tabular-nums sm:table-cell">
                  {formatDuration(w.p95LatencyMs)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

function OverviewSkeleton() {
  return (
    <>
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </>
  )
}

export function OverviewPage() {
  const { window } = useTimeWindow()
  const query = useQuery(overviewQuery(window))
  const data = query.data

  return (
    <Page>
      <PageHeader
        title="Resumen"
        description={
          data ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <StatusDot tone="ok" live small />
              {windowTitle[window]} · actualizado{" "}
              <RelativeTime value={data.generatedAt} /> · se refresca cada 15 s
            </span>
          ) : (
            windowTitle[window]
          )
        }
      />
      {query.isError && !data ? (
        <QueryError query={query} />
      ) : null}
      {!data && query.isPending ? <OverviewSkeleton /> : null}
      {data ? (
        <>
          <ServiceStrip services={data.services} />
          <KpiGrid data={data} />
          <div className="grid gap-3 lg:grid-cols-3">
            <StatusChart window={window} />
            <StatusBreakdown data={data} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <StuckRequests />
            <TopErrors data={data} />
          </div>
          <WakeAdapters data={data} />
        </>
      ) : null}
    </Page>
  )
}
