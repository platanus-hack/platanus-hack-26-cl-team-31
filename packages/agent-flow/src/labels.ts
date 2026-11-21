// Textos en español del visualizador. Una sola tabla por concepto.
import { BROKER, type FlowEndpoint, type FlowEvent, type FlowStatus, type FlowStep } from "./model.js";

export const statusLabels: Record<FlowStatus, string> = {
  pending: "En curso",
  ok: "Ok",
  allowed: "Permitido",
  denied: "Denegado",
  blocked: "Bloqueado",
  sanitized: "Saneado",
  escalated: "Escalado",
  delivered: "Entregado",
  expired: "Expirado",
  failed: "Falló",
};

export const stepLabels: Record<FlowStep, string> = {
  ask: "Pregunta",
  policy: "Política",
  request: "Solicitud firmada",
  wake: "Aviso",
  inbox: "Lee la bandeja",
  reply: "Responde",
  sanitized: "Respuesta saneada",
  reply_blocked: "Respuesta bloqueada",
  escalated: "Escala al titular",
  owner_decided: "Decide el titular",
  delivered: "Resultado final",
  check: "Consulta el estado",
  tool: "Tool",
  joined: "Se unió a la red",
  left: "Salió de la red",
};

/** Etiqueta corta del último paso dentro de la fila de un actor. */
export const rowStepLabels: Record<FlowStep, string> = {
  ask: "Pregunta",
  policy: "Política",
  request: "Firmada",
  wake: "Aviso",
  inbox: "Bandeja",
  reply: "Responde",
  sanitized: "Saneada",
  reply_blocked: "Bloqueada",
  escalated: "Consultado",
  owner_decided: "Decide",
  delivered: "Recibe",
  check: "Consulta",
  tool: "Tool",
  joined: "Se unió",
  left: "Salió",
};

const toolLabels: Record<string, string> = {
  availability: "Disponibilidad",
  interest_check: "Interés",
  question: "Pregunta",
  profile: "Perfil",
  connect: "Conexión",
};

const categoryLabels: Record<string, string> = {
  availability: "Disponibilidad horaria",
  interests: "Intereses",
  health: "Salud",
  general: "Preguntas abiertas",
};

const ruleLabels: Record<string, string> = {
  grant: "permiso directo",
  circle: "círculo",
  no_grant: "sin permiso",
  no_recipient: "sin destinatario",
  connection_request: "invitación",
};

const outcomeLabels: Record<string, string> = {
  answered: "respondida",
  no_data: "sin datos",
  declined: "rechazada",
  denied: "denegada",
  expired: "expirada",
  delivery_failed: "aviso fallido",
  awaiting_owner: "necesita al titular",
  approve_once: "aprueba una vez",
  answer: "responde",
  deny: "deniega",
  accept: "acepta",
  decline: "rechaza",
};

export const toolLabel = (tool?: string) => (tool ? (toolLabels[tool] ?? tool) : undefined);
export const categoryLabel = (category?: string) => (category ? (categoryLabels[category] ?? category) : undefined);
export const ruleLabel = (rule?: string) => (rule ? (ruleLabels[rule] ?? rule) : undefined);
export const outcomeLabel = (outcome?: string) => (outcome ? (outcomeLabels[outcome] ?? outcome) : undefined);

export function endpointLabel(endpoint: FlowEndpoint): string {
  if (endpoint === BROKER) return "Broker";
  if (endpoint.role === "owner") return `${endpoint.owner.label} (titular)`;
  return `${endpoint.label} de ${endpoint.owner.label}`;
}

/** Detalle corto del paso, sin datos de terceros: solo códigos traducidos. */
export function stepDetail(event: FlowEvent): string {
  const { meta } = event;
  switch (event.step) {
    case "ask":
      return [toolLabel(meta.tool), categoryLabel(meta.category)].filter(Boolean).join(" · ");
    case "policy":
      return [statusLabels[event.status], ruleLabel(meta.rule)].filter(Boolean).join(" · ");
    case "wake":
      return [meta.attempt ? `intento ${meta.attempt}` : undefined, meta.httpStatus ? `HTTP ${meta.httpStatus}` : undefined]
        .filter(Boolean)
        .join(" · ");
    case "reply":
      return outcomeLabel(meta.outcome) ?? "";
    case "sanitized":
      return meta.fieldsDropped?.length ? `descarta ${meta.fieldsDropped.join(", ")}` : `${meta.flags?.length ?? 0} hallazgos`;
    case "reply_blocked":
      return meta.code ?? "";
    case "owner_decided":
      return outcomeLabel(meta.decision) ?? "";
    case "delivered":
      return [outcomeLabel(meta.outcome), event.status === "denied" ? "firmada, sin motivo" : undefined].filter(Boolean).join(" · ");
    case "tool":
      return meta.tool ?? "";
    default:
      return "";
  }
}

/** Frase completa para lectores de pantalla y la línea de tiempo. */
export function describeEvent(event: FlowEvent): string {
  const detail = stepDetail(event);
  const route = event.from === event.to ? endpointLabel(event.from) : `${endpointLabel(event.from)} → ${endpointLabel(event.to)}`;
  if (event.step === "joined" || event.step === "left") return `${route} ${event.step === "joined" ? "se unió a la red" : "salió de la red"}.`;
  return `${stepLabels[event.step]}${detail ? ` (${detail})` : ""}: ${route}. ${statusLabels[event.status]}.`;
}
