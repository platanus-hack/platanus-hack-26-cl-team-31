import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useNavigate, useSearchParams } from "react-router"
import type { UserSummary } from "@shared/contract"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CopyId } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import { FilterBar, SearchInput } from "@/components/filters"
import { PersonHoverCard } from "@/components/hover-cards"
import { ErrorState, Muted, Page, PageHeader, Panel } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { api } from "@/lib/api"

const columns: ColumnDef<UserSummary, unknown>[] = [
  {
    id: "person",
    accessorFn: (u) => u.displayName ?? u.address ?? u.userId,
    header: "Persona",
    cell: ({ row }) => (
      <PersonHoverCard id={row.original.userId}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {row.original.displayName ?? <Muted>Sin nombre</Muted>}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.original.address ?? "sin dirección"}
          </span>
        </span>
      </PersonHoverCard>
    ),
  },
  {
    accessorKey: "userId",
    header: "Id",
    enableSorting: false,
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => <CopyId value={row.original.userId} />,
  },
  {
    accessorKey: "agents",
    header: "Agentes",
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.agents}
      </span>
    ),
  },
  {
    accessorKey: "sent24h",
    header: "Enviadas 24 h",
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.sent24h}
      </span>
    ),
  },
  {
    accessorKey: "received24h",
    header: "Recibidas 24 h",
    meta: { className: "hidden sm:table-cell text-right" },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.received24h}
      </span>
    ),
  },
  {
    accessorKey: "lastActivityAt",
    header: "Actividad",
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.lastActivityAt}
        className="text-muted-foreground"
      />
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Alta",
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.createdAt}
        className="text-muted-foreground"
      />
    ),
  },
]

export function UsersPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get("q") ?? ""
  const query = useInfiniteQuery({
    queryKey: ["users", q],
    queryFn: ({ pageParam, signal }) =>
      api(
        "users",
        { query: { q: q || undefined, cursor: pageParam, limit: 50 } },
        { signal }
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const rows = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.items),
    [query.data]
  )
  const onSearch = React.useCallback(
    (value: string) => setParams(value ? { q: value } : {}, { replace: true }),
    [setParams]
  )

  return (
    <Page>
      <PageHeader
        title="Personas"
        description="Usuarios de Nexo con su dirección, agentes conectados y actividad reciente."
      />
      <FilterBar>
        <SearchInput
          label="Buscar persona"
          placeholder="Nombre, dirección o id"
          value={q}
          onChange={onSearch}
          className="sm:w-72"
        />
      </FilterBar>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <Panel>
        <DataTable
          columns={columns}
          data={rows}
          loading={query.isPending}
          getRowId={(u) => u.userId}
          onRowClick={(u) => navigate(`/personas/${u.userId}`)}
          empty={{
            title: "Sin personas",
            description: q ? `Nada coincide con «${q}».` : undefined,
          }}
        />
        {query.hasNextPage ? (
          <div className="flex justify-center border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Cargar más
            </Button>
          </div>
        ) : null}
      </Panel>
    </Page>
  )
}
