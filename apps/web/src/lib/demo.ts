import { z } from "zod";

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

const record = z.record(z.string(), z.unknown());
const ToolTrace = z.object({ tool: z.string(), input: record, data: record });
export type ToolTrace = z.infer<typeof ToolTrace>;
const ModelState = z.enum(["ready", "missing", "offline"]);
export type ModelState = z.infer<typeof ModelState>;
export const ChatReply = z.object({
  text: z.string(), traces: z.array(ToolTrace).optional(), error: z.enum(["model", "api"]).optional(), modelState: ModelState.optional(),
});
export type ChatReply = z.infer<typeof ChatReply>;
export type ChatTurn = { role: "user" | "assistant"; content: string };

export const maxMessage = 2000;
export const maxHistory = 12;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

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
  const date = new Date(slot);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}
