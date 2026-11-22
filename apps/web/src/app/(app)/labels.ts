import type { ActivityItem, RequestStatus, ToolName, WakeKind } from "@team-31/protocol";

export const toolLabels = {
  profile: "Perfil",
  availability: "Disponibilidad",
  question: "Pregunta",
  interest_check: "Interés",
  connect: "Conexión",
  vault_access: "Acceso a la bóveda",
} satisfies Record<ToolName, string>;

export const statusLabels = {
  awaiting_owner: "Por revisar",
  awaiting_agent: "Esperando al agente",
  answered: "Respondida",
  no_data: "Sin datos",
  declined: "Rechazada",
  denied: "Denegada por regla",
  expired: "Vencida",
  delivery_failed: "Error de entrega",
} satisfies Record<RequestStatus, string>;

export const eventLabels = {
  received: "Recibida",
  permission: "Permiso evaluado",
  wake: "Aviso al agente",
  response: "Respuesta del agente",
  delivery: "Cierre y entrega",
} satisfies Record<ActivityItem["events"][number]["kind"], string>;

export const wakeLabels = {
  none: "Sin aviso",
  openclaw_hooks: "OpenClaw",
  grokbot_routine: "Rutina de Grok Bot",
  standard_webhook: "Webhook",
  mcp_events: "Eventos MCP",
  polling: "Sondeo del agente",
} satisfies Record<WakeKind, string>;

export const fieldLabels: Partial<Record<string, string>> = {
  displayName: "Nombre",
  accepted: "Si acepta",
  headline: "Titular",
  available: "Si está disponible",
  freeSlots: "Horarios libres",
  answer: "Respuesta",
  matches: "Coincide con su interés",
};

const dateTime = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Santiago",
});

export function formatTime(value: string) {
  return dateTime.format(new Date(value));
}

const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });

export function formatRelative(value: string, now = Date.now()) {
  const minutes = Math.round((new Date(value).getTime() - now) / 60_000);
  const abs = Math.abs(minutes);
  if (abs < 60) return relative.format(minutes, "minute");
  if (abs < 60 * 24) return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / (60 * 24)), "day");
}

const slotDay = new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function formatSlotDay(date: string) {
  return slotDay.format(new Date(`${date}T12:00:00Z`));
}
