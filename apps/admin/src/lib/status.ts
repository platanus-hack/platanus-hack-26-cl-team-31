// Etiquetas en español y tono semántico para estados del dominio (docs/admin.md §7):
// answered verde, no_data gris, declined/denied ámbar, expired/delivery_failed rojo, awaiting_* azul.
import type { RequestStatus, ToolName, WakeKind } from "@team-31/protocol"
import type { Service, ServiceHealth, TelemetryEvent } from "@shared/contract"

export type Tone = "ok" | "warn" | "error" | "info" | "neutral"

export const requestStatusMeta: Record<
  RequestStatus,
  { label: string; tone: Tone }
> = {
  awaiting_agent: { label: "Esperando agente", tone: "info" },
  awaiting_owner: { label: "Esperando dueño", tone: "info" },
  answered: { label: "Respondida", tone: "ok" },
  no_data: { label: "Sin datos", tone: "neutral" },
  declined: { label: "Rechazada", tone: "warn" },
  denied: { label: "Denegada", tone: "warn" },
  expired: { label: "Vencida", tone: "error" },
  delivery_failed: { label: "Aviso fallido", tone: "error" },
}

export const requestStatusOrder: RequestStatus[] = [
  "awaiting_agent",
  "awaiting_owner",
  "answered",
  "no_data",
  "declined",
  "denied",
  "expired",
  "delivery_failed",
]

export const toolLabel: Record<ToolName, string> = {
  availability: "Disponibilidad",
  question: "Pregunta",
  profile: "Perfil",
  interest_check: "Interés",
  connect: "Conexión",
  vault_access: "Acceso a la bóveda",
}

export const wakeKindLabel: Record<WakeKind, string> = {
  none: "Sin aviso",
  openclaw_hooks: "OpenClaw",
  grokbot_routine: "Grok",
  standard_webhook: "Webhook",
  mcp_events: "MCP events",
}

export const serviceLabel: Record<Service, string> = {
  web: "web",
  mcp: "mcp",
  broker: "broker",
  worker: "worker",
  admin: "admin",
  coordination: "coord",
}

// Color estable por servicio para la cascada y los eventos.
export const serviceColor: Record<Service, string> = {
  web: "var(--chart-5)",
  mcp: "var(--chart-1)",
  broker: "var(--chart-3)",
  worker: "var(--chart-4)",
  admin: "var(--status-neutral)",
  coordination: "var(--chart-2)",
}

export const healthMeta: Record<
  ServiceHealth["state"],
  { label: string; tone: Tone }
> = {
  up: { label: "Activo", tone: "ok" },
  stale: { label: "Sin latido reciente", tone: "warn" },
  down: { label: "Caído", tone: "error" },
}

export const levelTone: Record<TelemetryEvent["level"], Tone> = {
  debug: "neutral",
  info: "info",
  warn: "warn",
  error: "error",
}

export const levelLabel: Record<TelemetryEvent["level"], string> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
}

export const toneVar: Record<Tone, string> = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  info: "var(--status-info)",
  neutral: "var(--status-neutral)",
}

export const toneText: Record<Tone, string> = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  error: "text-status-error",
  info: "text-status-info",
  neutral: "text-status-neutral",
}

export const toneBg: Record<Tone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  error: "bg-status-error",
  info: "bg-status-info",
  neutral: "bg-status-neutral",
}
