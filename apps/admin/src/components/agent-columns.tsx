import type { ColumnDef } from "@tanstack/react-table"
import type { AgentRow } from "@shared/contract"
import { BanIcon, MoreHorizontalIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CopyId } from "@/components/copy-id"
import { PersonHoverCard } from "@/components/hover-cards"
import { Muted } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { ToneBadge } from "@/components/status"
import { formatPercent } from "@/lib/format"
import { toneVar, wakeKindLabel, type Tone } from "@/lib/status"

export function agentHealth(agent: AgentRow): { tone: Tone; label: string } {
  if (agent.revokedAt) return { tone: "neutral", label: "Revocado" }
  if (agent.wakeKind === "none") return { tone: "neutral", label: "Sin aviso" }
  const { ok, failed } = agent.wakes24h
  if (ok + failed === 0) return { tone: "neutral", label: "Sin tráfico" }
  const failRatio = failed / (ok + failed)
  if (failRatio > 0.5) return { tone: "error", label: "Fallando" }
  if (failRatio > 0.1) return { tone: "warn", label: "Inestable" }
  return { tone: "ok", label: "Sano" }
}

export function agentColumns({
  showUser = true,
  onRevoke,
}: {
  showUser?: boolean
  onRevoke?: (agent: AgentRow) => void
}): ColumnDef<AgentRow, unknown>[] {
  const columns: ColumnDef<AgentRow, unknown>[] = [
    {
      accessorKey: "label",
      header: "Agente",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              "truncate font-medium",
              row.original.revokedAt && "text-muted-foreground line-through"
            )}
          >
            {row.original.label}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.original.agentId}
          </span>
        </span>
      ),
    },
  ]
  if (showUser) {
    columns.push({
      accessorKey: "userId",
      header: "Persona",
      cell: ({ row }) => (
        <PersonHoverCard id={row.original.userId}>
          <span className="w-fit">
            <CopyId
              value={row.original.userId}
              to={`/personas/${row.original.userId}`}
            />
          </span>
        </PersonHoverCard>
      ),
    })
  }
  columns.push(
    {
      id: "health",
      header: "Salud",
      accessorFn: (a) => agentHealth(a).label,
      cell: ({ row }) => {
        const h = agentHealth(row.original)
        return <ToneBadge tone={h.tone}>{h.label}</ToneBadge>
      },
    },
    {
      accessorKey: "wakeKind",
      header: "Aviso",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span>{wakeKindLabel[row.original.wakeKind]}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.original.wakeHost ?? "—"}
          </span>
        </span>
      ),
    },
    {
      id: "wakes",
      header: "Avisos 24 h",
      accessorFn: (a) => a.wakes24h.failed,
      cell: ({ row }) => {
        const { ok, failed } = row.original.wakes24h
        const total = ok + failed
        if (!total) return <Muted />
        const tone = agentHealth(row.original).tone
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(ok / total) * 100}%`,
                      background: toneVar[tone],
                    }}
                  />
                </span>
                <span className="font-mono text-xs tabular-nums">
                  {ok}/{total}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {ok} entregados · {failed} fallidos · {formatPercent(ok / total)}
            </TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      accessorKey: "lastWakeAt",
      header: "Último aviso",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <RelativeTime
          value={row.original.lastWakeAt}
          className="text-muted-foreground"
        />
      ),
    },
    {
      accessorKey: "verifiedAt",
      header: "Verificado",
      meta: { className: "hidden xl:table-cell" },
      cell: ({ row }) => (
        <RelativeTime
          value={row.original.verifiedAt}
          className="text-muted-foreground"
        />
      ),
    }
  )
  if (onRevoke) {
    columns.push({
      id: "actions",
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      meta: { className: "w-10 text-right" },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Acciones"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                disabled={!!row.original.revokedAt}
                onSelect={() => onRevoke(row.original)}
              >
                <BanIcon />
                Revocar agente
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    })
  }
  return columns
}
