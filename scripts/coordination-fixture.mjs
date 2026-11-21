import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { group, slots, minutes } from "./coordination-scenario.mjs";

export { group, slots, minutes };

const member = { group, canAsk: true, canShare: true };
// Synthetic sources are copied into each owner's private file only at setup.
const participants = [
  { id: "ana", name: "Ana", interests: ["acuarela", "horticultura"] },
  { id: "bob", name: "Bob", interests: ["cerámica", "senderismo"], busySlots: [
    { start: slots[0], minutes, title: "Evento privado ficticio" },
  ] },
  { id: "carla", name: "Carla", interests: ["fermentación", "guitarra"] },
  { id: "agente4", name: "Diego", interests: ["bajo eléctrico", "grabación de campo"] },
  { id: "jane", name: "Jane", interests: ["astronomía", "compostaje"] },
  { id: "ines", name: "Inés", interests: ["cerámica", "grabado"] },
  { id: "luz", name: "Luz", interests: ["vidrio soplado", "mosaico"], privateInterests: true },
  { id: "mateo", name: "Mateo", interests: ["percusión", "escalada"] },
  { id: "sofia", name: "Sofía", interests: ["canto coral", "piano"] },
  { id: "leo", name: "Leo", interests: ["fotografía de aves", "orientación"] },
  { id: "tomas", name: "Tomás", interests: ["trail running", "cartografía"] },
  { id: "vera", name: "Vera", interests: ["trekking", "novela gráfica"] },
  { id: "alma", name: "Alma", interests: ["poesía", "encuadernación"] },
  { id: "nico", name: "Nico", interests: ["ciencia ficción", "ajedrez"] },
];
export const outsider = { id: "eva", name: "Eva", interests: ["traducción", "cuento breve"] };

// Within each circle, every pair starts in each other's address book.
export const circles = {
  taller: ["ana", "bob", "ines", "luz"],
  huerto: ["ana", "jane", "carla"],
  musica: ["carla", "agente4", "mateo", "sofia"],
  montana: ["mateo", "leo", "tomas", "vera"],
  lectura: ["vera", "alma", "nico", "eva"],
};

export function contactsOf(id) {
  const peers = Object.values(circles).filter(circle => circle.includes(id)).flat();
  return [...new Set(peers)].filter(peer => peer !== id);
}

export const identityPath = (directory, person) => join(directory, `${person}.json`);

export async function readIdentityToken(directory, person) {
  const content = await readFile(identityPath(directory, person), "utf8");
  let token;
  try {
    token = JSON.parse(content)?.mcpServers?.coordination?.env?.AGENT_TOKEN;
  } catch {
    // A parse error may include part of the secret. Report only a configuration error.
  }
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Credencial de demo inválida.");
  return token;
}

export function fixtureArgs([count = String(participants.length), directory, ...extra]) {
  if (extra.length || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) < 2) {
    throw new Error("Uso: [número de participantes >= 2] [directorio de configuraciones]");
  }
  const people = Array.from({ length: Number(count) }, (_, i) => {
    const person = participants[i] ?? { id: `agente${i + 1}`, name: `Agente ${i + 1}`, interests: [] };
    return { ...person, membership: member };
  });
  const configDir = directory ? resolve(directory) : fileURLToPath(new URL("../.agents-local", import.meta.url));
  return { people, configDir };
}
