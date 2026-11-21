// Vistas rápidas al pasar el cursor: persona y solicitud. Cargan sus datos solo al abrirse.
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Skeleton } from "@/components/ui/skeleton"
import { RelativeTime } from "@/components/relative-time"
import { RequestStatusBadge } from "@/components/status"
import { buildPath } from "@/lib/api"
import { formatDuration, initials } from "@/lib/format"
import { requestQuery, userQuery } from "@/lib/queries"
import { toolLabel } from "@/lib/status"

export function PersonHoverCard({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const query = useQuery({ ...userQuery(id), enabled: open, staleTime: 60_000 })
  const user = query.data
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-72" align="start">
        {!user ? (
          query.isError ? (
            <p className="text-sm text-muted-foreground">
              No se pudo cargar la persona.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar className="size-9">
                <AvatarFallback>
                  {initials(
                    user.summary.displayName ?? user.summary.address ?? id
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {user.summary.displayName ?? "Sin nombre"}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {user.summary.address ?? id}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Agentes", user.agents.filter((a) => !a.revokedAt).length],
                ["Enviadas", user.summary.sent24h],
                ["Recibidas", user.summary.received24h],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col rounded-md bg-muted/60 py-1.5"
                >
                  <dd className="font-mono text-sm tabular-nums">{value}</dd>
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {user.identity.email ?? "Sin correo"} ·{" "}
                {user.identity.activeSessions} sesiones
              </span>
              <Link
                to={buildPath("/personas/:id", { id: user.summary.userId })}
                className="inline-flex items-center gap-0.5 text-foreground hover:underline"
              >
                Abrir
                <ArrowRightIcon className="size-3" />
              </Link>
            </div>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

export function RequestHoverCard({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const query = useQuery({
    ...requestQuery(id),
    enabled: open,
    staleTime: 30_000,
  })
  const s = query.data?.summary
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80" align="start">
        {!s ? (
          query.isError ? (
            <p className="text-sm text-muted-foreground">
              No se pudo cargar la solicitud.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-60" />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{s.id}</span>
              <RequestStatusBadge status={s.status} />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {s.fromAddress} → {s.toAddress}
            </span>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{toolLabel[s.tool]}</span>·
              <span className="font-mono">{s.rule}</span>·
              <span>{formatDuration(s.durationMs)}</span>·
              <RelativeTime value={s.createdAt} />
            </span>
            <Link
              to={buildPath("/solicitudes/:id", { id: s.id })}
              className="inline-flex items-center gap-0.5 self-end text-xs hover:underline"
            >
              Abrir
              <ArrowRightIcon className="size-3" />
            </Link>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
