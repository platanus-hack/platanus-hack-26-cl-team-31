import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import type { WakeJobRow } from "@shared/contract"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CopyId } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import { FilterBar } from "@/components/filters"
import { RequestHoverCard } from "@/components/hover-cards"
import { ErrorState, Muted, Page, PageHeader, Panel } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { ToneBadge } from "@/components/status"
import { api } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { wakeKindLabel } from "@/lib/status"

type State = WakeJobRow["state"]

const columns: ColumnDef<WakeJobRow, unknown>[] = [
  {
    accessorKey: "requestId",
    header: "Solicitud",
    enableSorting: false,
    cell: ({ row }) => (
      <RequestHoverCard id={row.original.requestId}>
        <span className="w-fit">
          <CopyId
            value={row.original.requestId}
            to={`/solicitudes/${row.original.requestId}`}
          />
        </span>
      </RequestHoverCard>
    ),
  },
  {
    accessorKey: "state",
    header: "Estado",
    cell: ({ row }) => {
      const w = row.original
      if (w.state === "queued")
        return <ToneBadge tone="info">En cola</ToneBadge>
      if (w.state === "running")
        return <ToneBadge tone="info">Ejecutando</ToneBadge>
      return (
        <ToneBadge tone={w.ok ? "ok" : "error"}>
          {w.ok ? "Entregado" : "Fallido"}
        </ToneBadge>
      )
    },
  },
  {
    accessorKey: "attempt",
    header: "Intento",
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <span className="font-mono text-xs">#{row.original.attempt}</span>
    ),
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
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.httpStatus ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "code",
    header: "Código",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.code ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "id",
    header: "Job",
    enableSorting: false,
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => <CopyId value={row.original.id} />,
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

export function WakesPage() {
  const [state, setState] = React.useState<State | "all">("all")
  const query = useQuery({
    queryKey: ["wakes", state],
    queryFn: ({ signal }) =>
      api(
        "wakeQueue",
        { query: { state: state === "all" ? undefined : state } },
        { signal }
      ),
    placeholderData: (previous) => previous,
    refetchInterval: 10_000,
  })
  const failed =
    query.data?.items.filter((w) => w.state === "done" && w.ok === false)
      .length ?? 0

  return (
    <Page>
      <PageHeader
        title="Avisos"
        description="Cola de avisos del worker a los agentes: intentos, adaptador y respuesta HTTP (sin cuerpo)."
        actions={
          query.data ? (
            <span className="text-xs text-muted-foreground">
              {formatNumber(query.data.items.length)} jobs · {failed} fallidos
            </span>
          ) : null
        }
      />
      <FilterBar>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={state}
          onValueChange={(value) => value && setState(value as State | "all")}
          aria-label="Estado del job"
        >
          <ToggleGroupItem value="all">Todos</ToggleGroupItem>
          <ToggleGroupItem value="queued">En cola</ToggleGroupItem>
          <ToggleGroupItem value="running">Ejecutando</ToggleGroupItem>
          <ToggleGroupItem value="done">Terminados</ToggleGroupItem>
        </ToggleGroup>
      </FilterBar>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <Panel>
        <DataTable
          columns={columns}
          data={query.data?.items}
          loading={query.isPending}
          getRowId={(w) => w.id}
          empty={{ title: "Cola vacía" }}
        />
      </Panel>
    </Page>
  )
}
