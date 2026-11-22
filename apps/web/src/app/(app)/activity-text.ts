import type { ActivityItem, RequestStatus, ToolName } from "@team-31/protocol";

export const receivedText: Record<ToolName, string> = {
  availability: "te preguntó si estás libre",
  interest_check: "te preguntó por un interés",
  question: "te hizo una pregunta",
  connect: "quiere conectar contigo",
  vault_access: "pidió leer tu bóveda",
  category_access: "pidió permiso para consultar una categoría",
  profile: "pidió ver tu perfil",
};

export const sentText: Record<ToolName, (to: string) => string> = {
  availability: (to) => `Le preguntaste a ${to} si está libre`,
  interest_check: (to) => `Le preguntaste a ${to} por un interés`,
  question: (to) => `Le hiciste una pregunta a ${to}`,
  connect: (to) => `Invitaste a ${to}`,
  vault_access: (to) => `Pediste leer la bóveda de ${to}`,
  category_access: (to) => `Pediste permiso de categoría a ${to}`,
  profile: (to) => `Pediste el perfil de ${to}`,
};

export const outcomeText: Record<RequestStatus, [string, string, string]> = {
  awaiting_owner: ["Esperando respuesta", "text-warn", "bg-warn"],
  awaiting_agent: ["Esperando al agente", "text-info", "bg-info"],
  answered: ["Respondida", "text-success", "bg-success"],
  no_data: ["Sin datos", "text-muted", "bg-white/30"],
  declined: ["Rechazada", "text-muted", "bg-white/30"],
  denied: ["Bloqueada por permisos", "text-danger", "bg-danger"],
  expired: ["Vencida", "text-muted", "bg-white/30"],
  delivery_failed: ["No se pudo entregar", "text-danger", "bg-danger"],
};

export function sentence(item: ActivityItem) {
  const other = item.direction === "sent" ? item.to : item.from;
  return item.direction === "sent" ? { other, lead: "", rest: sentText[item.tool](other) } : { other, lead: other, rest: receivedText[item.tool] };
}
