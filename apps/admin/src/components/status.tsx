import type { RequestStatus } from "@team-31/protocol"
import type { ServiceHealth, TelemetryEvent } from "@shared/contract"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import {
  healthMeta,
  levelLabel,
  levelTone,
  requestStatusMeta,
  toneBg,
  type Tone,
} from "@/lib/status"

// Punto de color con el tono semántico del estado. Pulsa si `live`.
export function StatusDot({
  tone,
  live,
  small,
  className,
}: {
  tone: Tone
  live?: boolean
  small?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0",
        small ? "size-1.5" : "size-2",
        className
      )}
      aria-hidden
    >
      {live ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60",
            toneBg[tone]
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-full rounded-full",
          toneBg[tone]
        )}
      />
    </span>
  )
}

// Badge neutro con punto de color: denso y legible en ambos temas.
export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <StatusDot tone={tone} small />
      {children}
    </Badge>
  )
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const meta = requestStatusMeta[status]
  return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
}

export function HealthBadge({ state }: { state: ServiceHealth["state"] }) {
  const meta = healthMeta[state]
  return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
}

export function LevelBadge({ level }: { level: TelemetryEvent["level"] }) {
  return <ToneBadge tone={levelTone[level]}>{levelLabel[level]}</ToneBadge>
}
