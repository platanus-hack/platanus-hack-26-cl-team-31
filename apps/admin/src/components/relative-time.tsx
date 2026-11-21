import { cn } from "cn"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatAbsolute, formatRelative, useNow } from "@/lib/format"

// Fecha relativa («hace 3 min») con la fecha absoluta en el tooltip.
export function RelativeTime({
  value,
  className,
}: {
  value: string | null | undefined
  className?: string
}) {
  const now = useNow()
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={value}
          className={cn("whitespace-nowrap tabular-nums", className)}
        >
          {formatRelative(value, now)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatAbsolute(value)}</TooltipContent>
    </Tooltip>
  )
}
