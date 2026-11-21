import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import type { AuditEntry } from "@shared/contract"
import { BotIcon, UserIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DataTable } from "@/components/data-table"
import { ErrorState, Muted, Page, PageHeader, Panel } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { ToneBadge } from "@/components/status"
import { api } from "@/lib/api"
import type { Tone } from "@/lib/status"

const actionTone = (action: string): Tone => {
  if (action === "admin.reveal") return "warn"
  if (action === "admin.action" || action === "admin.token.revoked")
    return "error"
  if (action === "admin.token.created") return "info"
  return "neutral"
}

const columns: ColumnDef<AuditEntry, unknown>[] = [
  {
    accessorKey: "at",
    header: "Cuándo",
    cell: ({ row }) => (
      <RelativeTime value={row.original.at} className="text-muted-foreground" />
    ),
  },
  {
    accessorKey: "actorLabel",
    header: "Actor",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        {row.original.actorType === "token" ? (
          <BotIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <UserIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="truncate">{row.original.actorLabel}</span>
      </span>
    ),
  },
  {
    accessorKey: "action",
    header: "Acción",
    cell: ({ row }) => (
      <ToneBadge tone={actionTone(row.original.action)} className="font-mono">
        {row.original.action}
      </ToneBadge>
    ),
  },
  {
    accessorKey: "target",
    header: "Objetivo",
    cell: ({ row }) =>
      row.original.target ? (
        <span className="font-mono text-xs">{row.original.target}</span>
      ) : (
        <Muted />
      ),
  },
  {
    accessorKey: "reason",
    header: "Motivo",
    enableSorting: false,
    meta: { className: "max-w-80 whitespace-normal" },
    cell: ({ row }) =>
      row.original.reason ? (
        <span className="line-clamp-2 text-muted-foreground">
          {row.original.reason}
        </span>
      ) : (
        <Muted />
      ),
  },
  {
    accessorKey: "ip",
    header: "IP",
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.ip ?? "—"}
      </span>
    ),
  },
]

export function AuditPage() {
  const query = useInfiniteQuery({
    queryKey: ["audit"],
    queryFn: ({ pageParam, signal }) =>
      api("audit", { query: { cursor: pageParam } }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const rows = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.items),
    [query.data]
  )

  return (
    <Page>
      <PageHeader
        title="Auditoría"
        description="Cada login, revelación, acción de operador, token y llamada al MCP admin, con su motivo."
        actions={<Badge variant="outline">admin.audit</Badge>}
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <Panel>
        <DataTable
          columns={columns}
          data={rows}
          loading={query.isPending}
          getRowId={(a) => a.id}
          empty={{ title: "Sin registros" }}
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
