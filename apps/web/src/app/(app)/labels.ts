import type { ActivityItem, RequestStatus, ToolName, WakeKind } from "@team-31/protocol";

export const toolLabels = {
  profile: "Perfil",
  availability: "Disponibilidad",
  question: "Pregunta",
  interest_check: "Interés",
  connect: "Conexión",
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

export const activityPageSize = 20;

export function parseActivityPage(input: unknown) {
  if (typeof input !== "string" || !/^[1-9][0-9]*$/.test(input)) return 1;
  const value = Number(input);
  return Number.isSafeInteger(value * activityPageSize + 1) ? value : 1;
}
