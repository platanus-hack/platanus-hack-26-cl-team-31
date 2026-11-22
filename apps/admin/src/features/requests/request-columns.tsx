import type { ColumnDef } from "@tanstack/react-table"
import type { RequestSummary } from "@shared/contract"
import { ArrowRightIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyId } from "@/components/copy-id"
import { RelativeTime } from "@/components/relative-time"
import { RequestStatusBadge, StatusDot } from "@/components/status"
import { formatDuration } from "@/lib/format"
import { toolLabel } from "@/lib/status"

export const requestColumns: ColumnDef<RequestSummary, unknown>[] = [
  {
    accessorKey: "id",
    header: "Solicitud",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <CopyId
          value={row.original.id}
          to={`/solicitudes/${row.original.id}`}
        />
        {row.original.stuck ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlertIcon
                className="size-3.5 text-status-error"
                aria-label="Atascada"
              />
            </TooltipTrigger>
            <TooltipContent>
              Atascada: abierta con el plazo vencido
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ row }) => <RequestStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "tool",
    header: "Herramienta",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {toolLabel[row.original.tool]}
      </span>
    ),
  },
  {
    id: "route",
    header: "De → Para",
    enableSorting: false,
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 font-mono text-xs">
        <span className="max-w-32 truncate">{row.original.fromAddress}</span>
        <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="max-w-32 truncate">{row.original.toAddress}</span>
      </span>
    ),
  },
  {
    accessorKey: "rule",
    header: "Regla",
    meta: { className: "hidden 2xl:table-cell" },
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.rule}
      </span>
    ),
  },
  {
    accessorKey: "wakeAttempts",
    header: "Avisos",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => {
      const { wakeAttempts, lastWakeOk } = row.original
      if (wakeAttempts === 0)
        return <span className="text-muted-foreground">Sin intentos</span>
      if (lastWakeOk === null)
        return (
          <span className="text-muted-foreground">
            {wakeAttempts} · Sin resultado
          </span>
        )
      return (
        <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
          <StatusDot tone={lastWakeOk ? "ok" : "error"} small />
          {wakeAttempts} · {lastWakeOk ? "Último entregado" : "Último fallido"}
        </span>
      )
    },
  },
  {
    accessorKey: "durationMs",
    header: "Duración",
    meta: { className: "hidden lg:table-cell text-right" },
    cell: ({ row }) => (
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          row.original.durationMs === null && "text-muted-foreground"
        )}
      >
        {formatDuration(row.original.durationMs)}
      </span>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Creada",
    meta: { className: "text-right" },
    cell: ({ row }) => (
      <RelativeTime
        value={row.original.createdAt}
        className="text-muted-foreground"
      />
    ),
  },
]
