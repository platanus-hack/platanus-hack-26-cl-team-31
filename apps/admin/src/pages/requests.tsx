import * as React from "react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { TriangleAlertIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router"
import { RequestStatus, ToolName } from "@team-31/protocol"

import { LoadMore } from "@/components/load-more"
import { cursorPagination, usePageItems } from "@/lib/queries"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { DataTable } from "@/components/data-table"
import {
  ClearFilters,
  FilterBar,
  MultiSelectFilter,
  SearchInput,
  SelectFilter,
} from "@/components/filters"
import { QueryError, Page, PageHeader, Panel } from "@/components/page"
import { requestColumns } from "@/components/request-columns"
import { StatusDot } from "@/components/status"
import { api } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { requestStatusMeta, requestStatusOrder, toolLabel } from "@/lib/status"

function useRequestFilters() {
  const [params, setParams] = useSearchParams()
  const status = params
    .getAll("status")
    .filter((s): s is RequestStatus => RequestStatus.safeParse(s).success)
  const toolParsed = ToolName.safeParse(params.get("tool"))
  const filters = {
    status,
    tool: toolParsed.success ? toolParsed.data : undefined,
    address: params.get("address") ?? "",
    q: params.get("q") ?? "",
    stuck: params.get("stuck") === "1",
  }
  const update = React.useCallback(
    (patch: Partial<typeof filters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            next.delete(key)
            if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
            else if (value === true) next.set(key, "1")
            else if (typeof value === "string" && value) next.set(key, value)
          }
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )
  const clear = () => setParams(new URLSearchParams(), { replace: true })
  const active =
    status.length > 0 ||
    !!filters.tool ||
    !!filters.address ||
    !!filters.q ||
    filters.stuck
  return { filters, update, clear, active }
}

export function RequestsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, active } = useRequestFilters()
  const query = useInfiniteQuery({
    queryKey: ["requests", filters],
    queryFn: ({ pageParam, signal }) =>
      api(
        "requests",
        {
          query: {
            status: filters.status.length ? filters.status : undefined,
            tool: filters.tool,
            address: filters.address || undefined,
            q: filters.q || undefined,
            stuck: filters.stuck || undefined,
            cursor: pageParam,
            limit: 50,
          },
        },
        { signal }
      ),
    ...cursorPagination,
    placeholderData: keepPreviousData,
  })
  const rows = usePageItems(query.data)
  const onAddress = React.useCallback(
    (address: string) => update({ address }),
    [update]
  )
  const onQ = React.useCallback((q: string) => update({ q }), [update])

  return (
    <Page>
      <PageHeader
        title="Solicitudes"
        description="Cada pregunta entre agentes: estado, regla aplicada, avisos y duración. Sin payloads."
      />
      <FilterBar>
        <SearchInput
          label="Prefijo de request id"
          placeholder="req_…"
          mono
          value={filters.q}
          onChange={onQ}
          className="sm:w-44"
        />
        <SearchInput
          label="Dirección"
          placeholder="Dirección (de o para)"
          value={filters.address}
          onChange={onAddress}
        />
        <MultiSelectFilter
          label="Estado"
          options={requestStatusOrder}
          value={filters.status}
          onChange={(status) => update({ status })}
          renderOption={(s) => (
            <span className="flex items-center gap-2">
              <StatusDot tone={requestStatusMeta[s].tone} small />
              {requestStatusMeta[s].label}
            </span>
          )}
        />
        <SelectFilter
          label="Herramienta"
          allLabel="Todas las herramientas"
          options={ToolName.options}
          value={filters.tool}
          onChange={(tool) => update({ tool })}
          renderOption={(t) => toolLabel[t]}
        />
        <Toggle
          variant="outline"
          size="sm"
          pressed={filters.stuck}
          onPressedChange={(stuck) => update({ stuck })}
          aria-label="Solo atascadas"
        >
          <TriangleAlertIcon />
          Atascadas
        </Toggle>
        <ClearFilters visible={active} onClear={clear} />
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {query.isFetching && !query.isFetchingNextPage ? <Spinner /> : null}
          {rows
            ? `${formatNumber(rows.length)}${query.hasNextPage ? "+" : ""} solicitudes`
            : null}
        </span>
      </FilterBar>
      <QueryError query={query} />
      <Panel>
        <DataTable
          columns={requestColumns}
          data={rows}
          loading={query.isPending}
          onRowClick={(r) => navigate(`/solicitudes/${r.id}`)}
          getRowId={(r) => r.id}
          empty={{
            title: "Sin solicitudes",
            description: active
              ? "Prueba con otros filtros."
              : "Todavía no hay solicitudes.",
          }}
        />
        <LoadMore query={query} />
      </Panel>
    </Page>
  )
}
