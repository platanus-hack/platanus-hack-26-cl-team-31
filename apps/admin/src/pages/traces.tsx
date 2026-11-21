import * as React from "react"
import { ArrowRightIcon, BugIcon, InboxIcon, SearchIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"

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
import type { Span } from "@/features/traces/model"
import { useRecentTraces, useTraceLayout } from "@/features/traces/queries"
import { Waterfall } from "@/features/traces/waterfall"
import { formatAbsolute, formatDuration } from "@/lib/format"
import { serviceColor, serviceLabel } from "@/lib/status"

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
  const query = useTraceLayout(id)
  const [selected, setSelected] = React.useState<string | null>(null)
  const trace = query.data
  const summary = trace?.summary
  const selectedSpan = trace?.rows.find((span) => span.spanId === selected)

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
              ·<span>{summary.spanCount} spans</span>·
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
              layout={trace}
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
  const recent = useRecentTraces()

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
              {recent.data.map((t) => (
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
                              background: serviceColor[s],
                            }}
                          />
                          {serviceLabel[s]}
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
