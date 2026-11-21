export const people = {
  ana: { name: "Ana", role: "Organizadora" },
  bob: { name: "Bob", role: "Participante" },
  carla: { name: "Carla", role: "Participante" },
  eva: { name: "Eva", role: "Fuera del grupo" },
} as const;

export type Person = keyof typeof people;
export const identities = Object.keys(people) as Person[];

export function isPerson(value: unknown): value is Person {
  return typeof value === "string" && Object.hasOwn(people, value);
}

export type ChatReply = {
  text: string;
  tool?: string;
  data?: Record<string, unknown>;
};

export const commands = {
  available: "¿Bob está libre a las 18:00?",
  busy: "¿Bob está libre a las 16:00?",
  saved: "Ver consulta anterior",
  propose: "Propón fútbol a las 16:00 o 18:00",
  inbox: "Ver mi bandeja",
  respond: "Responder con mi agenda",
  get: "Ver estado del encuentro",
  accept: "Acepto el horario",
  decline: "Rechazo el horario",
  revoke: "Dejar de compartir mi disponibilidad",
  restore: "Volver a compartir mi disponibilidad",
} as const;

export const statuses: Record<string, string> = {
  available: "Disponible",
  busy: "Ocupado",
  not_shareable: "No compartible",
  collecting: "Esperando respuestas",
  proposed: "Esperando aceptaciones",
  confirmed: "Confirmado",
  no_shared_slot: "Sin horario en común",
  declined: "Rechazado",
  updated: "Permiso actualizado",
};

export function formatSlot(slot: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(slot));
}
