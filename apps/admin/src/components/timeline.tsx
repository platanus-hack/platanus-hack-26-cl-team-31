import type { TimelineItem } from "@shared/contract"
import { BugIcon, WaypointsIcon } from "lucide-react"
import { Link } from "react-router"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { StatusDot } from "@/components/status"
import { formatAbsolute, formatClock, formatDuration } from "@/lib/format"
import { levelTone, serviceLabel } from "@/lib/status"

export function AttrChips({
  attrs,
  className,
}: {
  attrs: Record<string, string | number | boolean | null>
  className?: string
}) {
  const entries = Object.entries(attrs).filter(
    ([, v]) => v !== null && v !== ""
  )
  if (entries.length === 0) return null
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="rounded-sm bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground"
        >
          {key}=<span className="text-foreground">{String(value)}</span>
        </span>
      ))}
    </div>
  )
}

function offsetLabel(ms: number) {
  return ms < 1000 ? `+${ms} ms` : `+${formatDuration(ms)}`
}

// Línea de tiempo combinada: request_events del broker + telemetría de todos los servicios.
export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Sin eventos.
      </p>
    )
  const start = Date.parse(items[0]!.at)
  return (
    <ol className="relative flex flex-col">
      {items.map((item, i) => {
        const tone = levelTone[item.level]
        const isEvent = item.source === "request_event"
        return (
          <li
            key={`${item.at}-${i}`}
            className="group/item grid grid-cols-[4.5rem_1rem_1fr] gap-x-2 sm:grid-cols-[6.5rem_1rem_1fr]"
          >
            <div className="flex flex-col items-end pt-1.5 text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <time
                    dateTime={item.at}
                    className="font-mono text-xs tabular-nums"
                  >
                    {formatClock(item.at)}
                  </time>
                </TooltipTrigger>
                <TooltipContent>{formatAbsolute(item.at)}</TooltipContent>
              </Tooltip>
              <span className="hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:block">
                {offsetLabel(Date.parse(item.at) - start)}
              </span>
            </div>
            <div className="relative flex justify-center">
              <span
                className={cn(
                  "absolute top-0 bottom-0 w-px bg-border",
                  i === 0 && "top-3",
                  i === items.length - 1 && "bottom-auto h-3"
                )}
              />
              <span
                className={cn(
                  "relative mt-2 flex size-3 items-center justify-center rounded-full bg-background",
                  isEvent && "ring-1 ring-border"
                )}
              >
                <StatusDot tone={tone} small />
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1 pt-1 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "font-mono text-xs",
                    isEvent ? "font-semibold" : "font-medium"
                  )}
                >
                  {item.name}
                </span>
                {item.service ? (
                  <Badge
                    variant="outline"
                    className="h-4 px-1.5 font-mono text-[10px]"
                  >
                    {serviceLabel[item.service]}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                    request_event
                  </Badge>
                )}
                {item.status ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {item.status}
                  </span>
                ) : null}
                {item.durationMs !== null ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDuration(item.durationMs)}
                  </span>
                ) : null}
                <span className="ml-auto flex items-center gap-1">
                  {item.errorId ? (
                    <Link
                      to={`/errores/${item.errorId}`}
                      className="inline-flex items-center gap-1 text-[11px] text-status-error hover:underline"
                    >
                      <BugIcon className="size-3" />
                      error
                    </Link>
                  ) : null}
                  {item.traceId ? (
                    <Link
                      to={`/trazas/${item.traceId}`}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <WaypointsIcon className="size-3" />
                      traza
                    </Link>
                  ) : null}
                </span>
              </div>
              <AttrChips attrs={item.attrs} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
