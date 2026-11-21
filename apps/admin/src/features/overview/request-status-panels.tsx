import type { Overview, Window } from "@shared/contract"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Link } from "react-router"

import { QueryError } from "@/components/page"
import { StatusDot } from "@/components/status"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDayTime, formatDuration, formatShortTime } from "@/lib/format"
import { requestStatusMeta, requestStatusOrder, toneVar, toolLabel } from "@/lib/status"
import { windowPhrase } from "@/lib/window"
import { bucketMs, type Series } from "./request-history"
import { useRequestHistory } from "./queries"

const chartConfig = {
  ok: { label: "Respondidas", color: toneVar.ok },
  neutral: { label: "Sin datos", color: toneVar.neutral },
  warn: { label: "Rechazadas o denegadas", color: toneVar.warn },
  error: { label: "Vencidas o fallidas", color: toneVar.error },
  open: { label: "Abiertas", color: toneVar.info },
} satisfies ChartConfig
const seriesOrder: Series[] = ["ok", "neutral", "warn", "error", "open"]

export function StatusChart({ window }: { window: Window }) {
  const { query, buckets } = useRequestHistory(window)
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
              data={buckets}
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

export function StatusBreakdown({ requests }: { requests: Overview["requests"] }) {
  const total = Math.max(1, requests.total)
  const tools = Object.entries(requests.byTool).sort((a, b) => b[1] - a[1])
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
          const count = requests.byStatus[status] ?? 0
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
