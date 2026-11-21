import { cn } from "cn"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDuration } from "@/lib/format"
import { serviceColor, serviceLabel } from "@/lib/status"
import { isError, type layoutTrace } from "./model"

export function Waterfall({
  layout,
  selected,
  onSelect,
}: {
  layout: ReturnType<typeof layoutTrace>
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { rows, t0, total } = layout
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="sm:min-w-[640px]">
        <div className="grid grid-cols-[9rem_1fr] border-b text-[11px] text-muted-foreground sm:grid-cols-[minmax(12rem,34%)_1fr]">
          <div className="px-3 py-1.5">Span</div>
          <div className="relative h-7">
            {ticks.map((t) => (
              <span
                key={t}
                className={cn(
                  "absolute top-1.5 font-mono whitespace-nowrap tabular-nums",
                  t === 1
                    ? "-translate-x-full pr-2"
                    : t > 0 && "-translate-x-1/2",
                  (t === 0.25 || t === 0.75) && "hidden sm:inline"
                )}
                style={{ left: `${t * 100}%` }}
              >
                {t === 0 ? "0" : formatDuration(total * t)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[9rem] grid grid-cols-4 sm:left-[34%]">
            {ticks.slice(1).map((t) => (
              <span
                key={t}
                className="border-r border-dashed border-border/60 last:border-r-0"
              />
            ))}
          </div>
          {rows.map((row) => {
            const left = ((row.start - t0) / total) * 100
            const width = Math.max(0.4, ((row.end - row.start) / total) * 100)
            const error = isError(row)
            return (
              <button
                key={row.spanId}
                type="button"
                onClick={() => onSelect(row.spanId)}
                className={cn(
                  "grid w-full grid-cols-[9rem_1fr] items-center text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted/60 sm:grid-cols-[minmax(12rem,34%)_1fr]",
                  selected === row.spanId && "bg-muted"
                )}
              >
                <span
                  className="flex min-w-0 items-center gap-1.5 py-1.5 pr-2"
                  style={{ paddingLeft: `${0.75 + row.depth * 0.7}rem` }}
                >
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: serviceColor[row.service] }}
                  />
                  <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
                    {serviceLabel[row.service]}
                  </span>
                  <span
                    className={cn(
                      "truncate font-mono",
                      error && "text-status-error"
                    )}
                  >
                    {row.name}
                  </span>
                </span>
                <span className="relative h-7">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px]",
                          error && "ring-2 ring-status-error"
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: serviceColor[row.service],
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="flex flex-col gap-0.5 font-mono">
                      <span>{row.name}</span>
                      <span>
                        {serviceLabel[row.service]} ·{" "}
                        {formatDuration(row.durationMs)} · +
                        {formatDuration(row.start - t0)}
                      </span>
                      {row.status ? <span>status {row.status}</span> : null}
                    </TooltipContent>
                  </Tooltip>
                  <span
                    className={cn(
                      "pointer-events-none absolute top-1/2 -translate-y-1/2 px-1.5 font-mono text-[11px] whitespace-nowrap",
                      // Barras largas: la duración va dentro, al final de la barra.
                      width > 25
                        ? "font-medium text-background"
                        : "text-muted-foreground"
                    )}
                    style={
                      width > 25
                        ? { right: `${100 - left - width}%` }
                        : left + width > 85
                          ? { right: `${100 - left}%` }
                          : { left: `${left + width}%` }
                    }
                  >
                    {formatDuration(row.durationMs)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
