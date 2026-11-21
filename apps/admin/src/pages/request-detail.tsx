import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  LockIcon,
  RotateCwIcon,
  TimerOffIcon,
  WaypointsIcon,
} from "lucide-react"
import { Link, useParams } from "react-router"
import type { ColumnDef } from "@tanstack/react-table"
import type { RequestDetail, WakeJobRow } from "@shared/contract"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyButton, CopyId } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import {
  QueryError,
  KeyValues,
  Muted,
  Page,
  PageHeader,
  Panel,
} from "@/components/page"
import { ReasonActionDialog } from "@/components/reason-action-dialog"
import { RelativeTime } from "@/components/relative-time"
import { RevealDialog } from "@/components/reveal-dialog"
import { RequestStatusBadge, StatusDot, ToneBadge } from "@/components/status"
import { Timeline } from "@/components/timeline"
import { api } from "@/lib/api"
import { formatDuration, useNow } from "@/lib/format"
import { requestQuery } from "@/lib/queries"
import { toolLabel, wakeKindLabel } from "@/lib/status"
import { useSession } from "@/lib/session"

const wakeColumns: ColumnDef<WakeJobRow, unknown>[] = [
  {
    accessorKey: "attempt",
    header: "#",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.attempt}</span>
    ),
  },
  {
    accessorKey: "id",
    header: "Job",
    enableSorting: false,
    cell: ({ row }) => <CopyId value={row.original.id} />,
  },
  {
    accessorKey: "state",
    header: "Estado",
    cell: ({ row }) => {
      const w = row.original
      if (w.state !== "done")
        return (
          <ToneBadge tone="info">
            {w.state === "queued" ? "En cola" : "Ejecutando"}
          </ToneBadge>
        )
      return (
        <ToneBadge tone={w.ok ? "ok" : "error"}>
          {w.ok ? "Entregado" : "Fallido"}
        </ToneBadge>
      )
    },
  },
  {
    accessorKey: "kind",
    header: "Adaptador",
    cell: ({ row }) =>
      row.original.kind ? wakeKindLabel[row.original.kind] : <Muted />,
  },
  {
    accessorKey: "httpStatus",
    header: "HTTP",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.httpStatus ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "code",
    header: "Código",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.code ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "runAt",
    header: "Programado",
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.runAt}
        className="text-muted-foreground"
      />
    ),
  },
]

function FieldList({
  label,
  items,
  tone,
}: {
  label: string
  items: string[]
  tone?: "ok" | "warn"
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {items.length === 0 ? (
        <Muted>Ninguno</Muted>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) =>
            tone ? (
              <ToneBadge key={item} tone={tone} className="font-mono">
                {item}
              </ToneBadge>
            ) : (
              <Badge key={item} variant="secondary" className="font-mono">
                {item}
              </Badge>
            )
          )}
        </div>
      )}
    </div>
  )
}

function PolicyTab({ detail }: { detail: RequestDetail }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Decisión de política</CardTitle>
        <CardDescription className="text-xs">
          Regla{" "}
          <span className="font-mono text-foreground">
            {detail.summary.rule}
          </span>
          {detail.summary.escalated ? " · escalada al dueño" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldList
            label="Campos permitidos"
            items={detail.allowedFields}
            tone="ok"
          />
          <FieldList
            label="Campos descartados"
            items={detail.droppedFields}
            tone="warn"
          />
        </div>
        <KeyValues
          className="lg:grid-cols-2"
          items={[
            {
              label: "Motivo de la decisión",
              value: detail.decisionReason ?? <Muted />,
            },
            {
              label: "Motivo interno del dueño",
              value: detail.internalReason ?? <Muted />,
            },
            {
              label: "Respuesta firmada",
              value: detail.responseSigned ? "Sí" : "No",
            },
            {
              label: "Escalada",
              value: detail.summary.escalated ? "Sí" : "No",
            },
          ]}
        />
      </CardContent>
    </Card>
  )
}

function PayloadTab({
  detail,
  isOperator,
}: {
  detail: RequestDetail
  isOperator: boolean
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Payload redactado</CardTitle>
        <CardDescription className="text-xs">
          El panel solo conoce las llaves. Los valores reales solo se ven al
          revelar, con motivo y auditoría.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldList label="Llaves de args" items={detail.argsKeys} />
          <FieldList label="Llaves de result" items={detail.resultKeys} />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Propósito</span>
            <span className="text-sm">
              {detail.hasPurpose ? "Incluido (redactado)" : "Sin propósito"}
            </span>
          </div>
        </div>
        {isOperator ? (
          <div>
            <RevealDialog requestId={detail.summary.id} />
          </div>
        ) : (
          <Alert>
            <LockIcon />
            <AlertTitle>Solo operadores</AlertTitle>
            <AlertDescription>
              Revelar el payload exige rol operator y una sesión reciente.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function Actions({ detail }: { detail: RequestDetail }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = React.useState<"rewake" | "expire" | null>(null)
  const { id, status, expiresAt } = detail.summary
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["request", id] })
    void queryClient.invalidateQueries({ queryKey: ["requests"] })
    void queryClient.invalidateQueries({ queryKey: ["overview"] })
  }
  const rewake = useMutation({
    mutationFn: (reason: string) =>
      api("rewake", { params: { id }, body: { reason } }),
    onSuccess: invalidate,
  })
  const expire = useMutation({
    mutationFn: (reason: string) =>
      api("expire", { params: { id }, body: { reason } }),
    onSuccess: invalidate,
  })

  const open = status === "awaiting_agent" || status === "awaiting_owner"
  const now = useNow()
  const overdue = Date.parse(expiresAt) < now
  const canRewake = status === "awaiting_agent" && !overdue
  const rewakeHint =
    status !== "awaiting_agent"
      ? "Solo en awaiting_agent"
      : overdue
        ? "Vencida: usa Expirar"
        : null

  return (
    <>
      <RevealDialog requestId={id} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={canRewake ? -1 : 0}>
            <Button
              variant="outline"
              size="sm"
              disabled={!canRewake}
              onClick={() => setDialog("rewake")}
            >
              <RotateCwIcon data-icon="inline-start" />
              Reintentar aviso
            </Button>
          </span>
        </TooltipTrigger>
        {rewakeHint ? <TooltipContent>{rewakeHint}</TooltipContent> : null}
      </Tooltip>
      <Button
        variant="destructive"
        size="sm"
        disabled={!open}
        onClick={() => setDialog("expire")}
      >
        <TimerOffIcon data-icon="inline-start" />
        Expirar
      </Button>
      <ReasonActionDialog
        open={dialog === "rewake"}
        onOpenChange={(next) => setDialog(next ? "rewake" : null)}
        title="Reintentar aviso"
        description="El broker encola un nuevo intento de aviso al agente destino. Queda un request_event admin_rewake."
        confirmLabel="Reintentar"
        icon={<RotateCwIcon />}
        onConfirm={(reason) => rewake.mutateAsync(reason)}
        successMessage="Aviso encolado"
      />
      <ReasonActionDialog
        open={dialog === "expire"}
        onOpenChange={(next) => setDialog(next ? "expire" : null)}
        title="Expirar solicitud"
        description="El broker la cierra como expired por el mismo camino del barrido. No se puede deshacer."
        confirmLabel="Expirar"
        destructive
        icon={<TimerOffIcon />}
        onConfirm={(reason) => expire.mutateAsync(reason)}
        successMessage="Solicitud expirada"
      />
    </>
  )
}

export function RequestDetailPage() {
  const { id = "" } = useParams()
  const { isOperator } = useSession()
  const query = useQuery({
    ...requestQuery(id),
    refetchInterval: (q) =>
      q.state.data?.summary.status.startsWith("awaiting") ? 5_000 : false,
  })
  const detail = query.data

  if (query.isError) {
    return (
      <Page>
        <PageHeader title={<span className="font-mono">{id}</span>} />
        <QueryError query={query} />
      </Page>
    )
  }

  if (!detail) {
    return (
      <Page>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-36" />
        <Skeleton className="h-80" />
      </Page>
    )
  }

  const s = detail.summary
  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base sm:text-lg">{s.id}</span>
            <CopyButton value={s.id} />
            <RequestStatusBadge status={s.status} />
            {s.stuck ? <ToneBadge tone="error">Atascada</ToneBadge> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-foreground">
              {s.fromAddress}
            </span>
            <ArrowRightIcon className="size-3" />
            <span className="font-mono text-xs text-foreground">
              {s.toAddress}
            </span>
            <span>· {toolLabel[s.tool]} · creada</span>
            <RelativeTime value={s.createdAt} />
          </span>
        }
        actions={
          isOperator ? (
            <Actions detail={detail} />
          ) : (
            <Badge variant="secondary">Solo lectura</Badge>
          )
        }
      />

      <Card size="sm">
        <CardContent>
          <KeyValues
            className="lg:grid-cols-4"
            items={[
              { label: "Herramienta", value: toolLabel[s.tool] },
              {
                label: "Regla",
                value: <span className="font-mono text-xs">{s.rule}</span>,
              },
              {
                label: "Resultado",
                value: s.outcome ? (
                  <RequestStatusBadge status={s.outcome} />
                ) : (
                  <Muted>Abierta</Muted>
                ),
              },
              {
                label: "Duración",
                value: (
                  <span className="font-mono text-xs">
                    {formatDuration(s.durationMs)}
                  </span>
                ),
              },
              {
                label: "Agente destino",
                value: s.targetAgentId ? (
                  <CopyId value={s.targetAgentId} />
                ) : (
                  <Muted />
                ),
              },
              {
                label: "Respondió",
                value: s.answeredByAgentId ? (
                  <CopyId value={s.answeredByAgentId} />
                ) : (
                  <Muted />
                ),
              },
              {
                label: "Avisos",
                value: (
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    {s.wakeAttempts > 0 ? (
                      <StatusDot tone={s.lastWakeOk ? "ok" : "error"} small />
                    ) : null}
                    {s.wakeAttempts} intento{s.wakeAttempts === 1 ? "" : "s"}
                  </span>
                ),
              },
              { label: "Vence", value: <RelativeTime value={s.expiresAt} /> },
              { label: "Cerrada", value: <RelativeTime value={s.closedAt} /> },
              {
                label: "Trazas",
                value: (
                  <span className="flex flex-wrap gap-2">
                    {detail.traceIds.length === 0 ? <Muted /> : null}
                    {detail.traceIds.map((t) => (
                      <Link
                        key={t}
                        to={`/trazas/${t}`}
                        className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                      >
                        <WaypointsIcon className="size-3 text-muted-foreground" />
                        {t.slice(0, 12)}…
                      </Link>
                    ))}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="timeline" className="min-w-0">
        <TabsList
          variant="line"
          className="no-scrollbar max-w-full overflow-x-auto"
        >
          <TabsTrigger value="timeline">
            Línea de tiempo{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {detail.timeline.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="wakes">
            Avisos{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {detail.wakes.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="policy">Política</TabsTrigger>
          <TabsTrigger value="payload">Payload</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <Card size="sm">
            <CardContent>
              <Timeline items={detail.timeline} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="wakes">
          <Panel>
            <DataTable
              columns={wakeColumns}
              data={detail.wakes}
              empty={{
                title: "Sin avisos",
                description:
                  "El destino no tiene aviso configurado o la política no llegó a avisar.",
              }}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="policy">
          <PolicyTab detail={detail} />
        </TabsContent>
        <TabsContent value="payload">
          <PayloadTab detail={detail} isOperator={isOperator} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
