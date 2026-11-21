import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { group, slots, minutes } from "./coordination-scenario.mjs";

export { group, slots, minutes };

const member = { group, canAsk: true, canShare: true };
const participants = [
  { id: "ana", membership: member },
  { id: "bob", membership: member, busySlots: [
    { start: slots[0], minutes, title: "Evento privado ficticio" },
  ] },
  { id: "carla", membership: member },
];
export const outsider = { id: "eva" };

export function fixtureArgs([count = "3", directory, ...extra]) {
  if (extra.length || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) < 2) {
    throw new Error("Uso: [número de participantes >= 2] [directorio de configuraciones]");
  }
  const people = Array.from({ length: Number(count) }, (_, i) =>
    participants[i] ?? { id: `agente${i + 1}`, membership: member });
  const configDir = directory ? resolve(directory) : fileURLToPath(new URL("../.agents-local", import.meta.url));
  return { people, configDir };
}
