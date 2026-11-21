import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const group = "futbol";
// Saturday, 16:00 and 18:00 in Santiago. Only the first slot conflicts with Bob's agenda.
export const slots = ["2026-11-28T19:00:00.000Z", "2026-11-28T21:00:00.000Z"];
export const minutes = 60;
export const adapter = fileURLToPath(new URL("../apps/mcp/dist/index.js", import.meta.url));

export function fixtureArgs([count = "3", directory, ...extra]) {
  if (extra.length || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) < 2) {
    throw new Error("Uso: [número de participantes >= 2] [directorio de configuraciones]");
  }
  const people = Array.from({ length: Number(count) }, (_, i) => ["ana", "bob", "carla"][i] ?? `agente${i + 1}`);
  const configDir = directory ? resolve(directory) : fileURLToPath(new URL("../.agents-local", import.meta.url));
  return { people, configDir };
}
