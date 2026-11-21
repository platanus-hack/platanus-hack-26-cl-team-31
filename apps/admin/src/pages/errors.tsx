import * as React from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { InboxIcon, WaypointsIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"
import { Service, type ErrorGroup } from "@shared/contract"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { eventReferences } from "@/components/event-references"
import { CopyButton, CopyId } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import {
  ClearFilters,
  FilterBar,
  SearchInput,
  SelectFilter,
} from "@/components/filters"
import {
  QueryError,
  KeyValues,
  Page,
  PageHeader,
  QueryPanel,
} from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { api } from "@/lib/api"
import { formatAbsolute, formatNumber } from "@/lib/format"
import { errorQuery } from "@/lib/queries"
import { serviceColor, serviceLabel } from "@/lib/status"
import { useTimeWindow, windowPhrase } from "@/lib/window"

const columns: ColumnDef<ErrorGroup, unknown>[] = [
  {
    accessorKey: "service",
    header: "Servicio",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 font-mono text-xs">
        <span
          className="size-1.5 rounded-[1px]"
          style={{ background: serviceColor[row.original.service] }}
        />
        {serviceLabel[row.original.service]}
      </span>
    ),
  },
  {
    accessorKey: "operation",
    header: "Operación",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.operation}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Tipo",
    cell: ({ row }) => (
      <span className="text-status-error">{row.original.type}</span>
    ),
  },
  {
    accessorKey: "count",
    header: "Veces",
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        ×{formatNumber(row.original.count)}
      </span>
    ),
  },
  {
    accessorKey: "firstAt",
    header: "Primero",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.firstAt}
        className="text-muted-foreground"
      />
    ),
  },
  {
    accessorKey: "lastAt",
    header: "Último",
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.lastAt}
        className="text-muted-foreground"
      />
    ),
  },
  {
    accessorKey: "sampleErrorId",
    header: "Muestra",
    enableSorting: false,
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => <CopyId value={row.original.sampleErrorId} max={12} />,
  },
]

function ErrorSheet({
  id,
  onClose,
}: {
  id: string | undefined
  onClose: () => void
}) {
  const query = useQuery({ ...errorQuery(id ?? ""), enabled: !!id })
  const event = query.data
  const frames =
    typeof event?.attrs.frames === "string" ? event.attrs.frames : null
  const issues =
    typeof event?.attrs.issues === "string" ? event.attrs.issues : null
  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-status-error">
            {event ? String(event.attrs.type ?? "Error") : "Error"}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {event
              ? `${serviceLabel[event.service]} · ${String(event.attrs.operation ?? "")}`
              : id}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {query.isPending ? <Skeleton className="h-40" /> : null}
          <QueryError query={query} />
          {event ? (
            <>
              <KeyValues
                className="lg:grid-cols-2"
                items={[
                  {
                    label: "errorId",
                    value: (
                      <CopyId value={event.errorId ?? id ?? ""} max={20} />
                    ),
                  },
                  { label: "Ocurrió", value: formatAbsolute(event.at) },
                  ...eventReferences(event),
                ]}
              />
              {issues ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    Problemas de validación
                  </span>
                  <pre className="rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                    {issues}
                  </pre>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Frames (solo del repo, sin mensajes crudos)
                  </span>
                  {frames ? (
                    <CopyButton value={frames} label="Copiar frames" />
                  ) : null}
                </div>
                <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                  {frames ?? "Sin frames."}
                </pre>
              </div>
            </>
          ) : null}
        </div>
        {event ? (
          <SheetFooter className="flex-row flex-wrap border-t">
            {event.traceId ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/trazas/${event.traceId}`}>
                  <WaypointsIcon data-icon="inline-start" />
                  Ver traza
                </Link>
              </Button>
            ) : null}
            {event.requestId ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/solicitudes/${event.requestId}`}>
                  <InboxIcon data-icon="inline-start" />
                  Ver solicitud
                </Link>
              </Button>
            ) : null}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function ErrorsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { window } = useTimeWindow()
  const [service, setService] = React.useState<Service | undefined>()
  const [operation, setOperation] = React.useState("")
  const query = useQuery({
    queryKey: ["errors", { window, service, operation }],
    queryFn: ({ signal }) =>
      api(
        "errors",
        { query: { window, service, operation: operation || undefined } },
        { signal }
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const total = query.data?.items.reduce((sum, e) => sum + e.count, 0) ?? 0

  return (
    <Page>
      <PageHeader
        title="Errores"
        description={`Agrupados por servicio, operación y tipo en ${windowPhrase[window]}${query.data ? ` · ${formatNumber(total)} ocurrencias` : ""}. Cambia la ventana arriba a la derecha.`}
      />
      <FilterBar>
        <SelectFilter
          label="Servicio"
          allLabel="Todos los servicios"
          options={Service.options}
          value={service}
          onChange={setService}
          renderOption={(s) => serviceLabel[s]}
        />
        <SearchInput
          label="Operación"
          placeholder="Operación (POST /v1/…)"
          mono
          value={operation}
          onChange={setOperation}
        />
        <ClearFilters
          visible={!!service || !!operation}
          onClear={() => {
            setService(undefined)
            setOperation("")
          }}
        />
      </FilterBar>
      <QueryPanel query={query}>
        <DataTable
          columns={columns}
          data={query.data?.items}
          loading={query.isPending}
          onRowClick={(e) => navigate(`/errores/${e.sampleErrorId}`)}
          getRowId={(e) => e.sampleErrorId}
          initialSorting={[{ id: "count", desc: true }]}
          empty={{
            title: "Sin errores",
            description: `Nada registrado en ${windowPhrase[window]}.`,
          }}
        />
      </QueryPanel>
      <ErrorSheet id={id} onClose={() => navigate("/errores")} />
    </Page>
  )
}
