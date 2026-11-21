import { group, minutes, slots } from "../../../../scripts/coordination-scenario.mjs";
import { commands, formatSlot, identities, people, type ChatReply, type Person } from "./demo";

type ToolCall = { tool: string; input: Record<string, unknown> };
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().trim().replace(/^[¿¡]+|[?.!]+$/g, "").replace(/\s+/g, " ");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDemoMessage(person: Person, message: string, meetingId: unknown, requestId: unknown): ToolCall | ChatReply {
  const text = normalize(message);
  const is = (command: keyof typeof commands) => text === normalize(commands[command]);
  const id = typeof meetingId === "string" && uuid.test(meetingId) ? meetingId : null;

  if (is("saved")) {
    return typeof requestId === "string" && uuid.test(requestId)
      ? { tool: "request_get", input: { request_id: requestId } }
      : { text: "Todavía no tienes una consulta guardada. Pregunta primero por un horario." };
  }
  if (is("propose")) {
    return { tool: "meeting_propose", input: { recipients: identities.filter(p => p !== person && p !== "eva"), group, slots, minutes } };
  }
  if (is("inbox")) return { tool: "meeting_inbox", input: {} };
  if (is("revoke") || is("restore")) return { tool: "group_permission", input: { group, can_share: is("restore") } };

  if (is("get") || is("respond") || is("accept") || is("decline")) {
    if (!id) return { text: "Primero propón un encuentro o selecciona uno de tu bandeja." };
    if (is("get")) return { tool: "meeting_get", input: { id } };
    if (is("respond")) return { tool: "meeting_respond", input: { id } };
    return { tool: "meeting_decide", input: { id, accept: is("accept") } };
  }

  const recipient = identities.filter(p => new RegExp(`\\b${p}\\b`).test(text));
  const times = [...text.matchAll(/\b(16|18):00\b|\ba las (16|18)\b(?!:)/g)];
  if (/\b(libre|disponibilidad|disponible|ocupad[oa])\b/.test(text) && recipient.length === 1 && times.length === 1) {
    const hour = times[0][1] ?? times[0][2];
    return { tool: "availability_check", input: { recipient: recipient[0], group, slot: slots[hour === "16" ? 0 : 1], minutes } };
  }
  return { text: "Esta demo entiende consultas de disponibilidad a las 16:00 o 18:00 y los comandos de los botones. Prueba «¿Bob está libre a las 18:00?»." };
}

export function describeResult({ tool, input }: ToolCall, data: Record<string, unknown>): string {
  const slot = typeof data.slot === "string" ? formatSlot(data.slot) : null;
  switch (data.status) {
    case "available":
    case "busy": {
      const recipient = identities.find(p => p === input.recipient);
      const name = recipient ? people[recipient].name : "Esa persona";
      const time = typeof input.slot === "string" ? ` a las ${formatSlot(input.slot)}` : "";
      return `${name} ${data.status === "available" ? "está disponible" : "tiene ese horario ocupado"}${time}. Nexo no revela el contenido de la agenda.`;
    }
    case "not_shareable": return "No compartible. Nexo no revela esta información a la identidad activa. Eso no significa que el horario esté ocupado.";
    case "collecting": return "Todavía faltan respuestas de agenda. Cambia a cada participante invitado y elige «Responder con mi agenda».";
    case "proposed": return `El horario en común es a las ${slot}. Cada participante, incluida la persona que propone, tiene que aceptar.`;
    case "confirmed": return `Encuentro confirmado a las ${slot}. Todas las personas aceptaron.`;
    case "no_shared_slot": return "No hay un horario en común entre las opciones propuestas.";
    case "declined": return "El encuentro no se confirmó porque alguien rechazó el horario.";
    case "updated": return data.can_share ? "Volviste a compartir tu disponibilidad con el grupo." : "Dejaste de compartir tu disponibilidad con el grupo.";
  }
  if (tool === "meeting_inbox" && Array.isArray(data.meetings)) {
    return data.meetings.length ? "Estas son las propuestas que esperan una acción tuya. Selecciona una para trabajar con ella." : "Tu bandeja no tiene encuentros que requieran una acción.";
  }
  return "Nexo respondió. Puedes revisar los datos en el inspector.";
}
