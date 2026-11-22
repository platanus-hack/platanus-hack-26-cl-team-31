import type { AgentContacts } from "@team-31/protocol";
import { describe, expect, it } from "vitest";
import { resolveRecipients } from "./recipients.js";

describe("selección de círculos", () => {
  const equipoAna = { id: "580dbc73-e07d-4e18-99d6-fa3aeb30931a", name: "Fútbol", members: ["ana@sideband.app"] };
  const equipoPaz = { id: "cbd4fa52-c55e-48b0-ab5b-2efe81a63470", name: "Fútbol", members: ["paz@sideband.app"] };
  const selector = { scope: "circle", count: "many", circle: "futbol" } as const;
  const agenda = (...circles: AgentContacts["circles"]) => async (): Promise<AgentContacts> => ({ contacts: [], circles });

  it("ofrece opciones distinguibles solo para los círculos homónimos", async () => {
    const otro = { ...equipoAna, id: "30ae45fe-b3a4-451e-bab3-e57029f07c34", name: "Tenis" };
    const result = await resolveRecipients(selector, agenda(equipoAna, otro, equipoPaz));
    expect(result).toMatchObject({ kind: "clarify", prompt: { field: "circle" } });
    if (result.kind !== "clarify") throw new Error("Se esperaba una aclaración");
    const choices = result.prompt.choices ?? [];
    expect(choices.map(choice => choice.value).sort()).toEqual([equipoAna.id, equipoPaz.id].sort());
    expect(new Set(choices.map(choice => choice.label)).size).toBe(2);
  });

  it("al reanudar usa el ID elegido y los miembros actuales aunque el círculo cambie de nombre", async () => {
    const actualizado = { ...equipoPaz, name: "Liga", members: ["luz@sideband.app"] };
    const result = await resolveRecipients(selector, agenda(equipoAna, actualizado), equipoPaz.id);
    expect(result).toEqual({ kind: "resolved", targets: actualizado.members, relation: { kind: "circle", circleId: equipoPaz.id } });
  });

  it("vuelve a preguntar si desapareció el círculo elegido y queda otro con el mismo nombre", async () => {
    const result = await resolveRecipients(selector, agenda(equipoAna), equipoPaz.id);
    expect(result).toMatchObject({ kind: "clarify", prompt: { field: "circle" } });
  });

  it("devuelve unsupported si el único círculo coincidente carece de ID en el directorio", async () => {
    const legacy = { name: equipoAna.name, members: equipoAna.members };
    expect(await resolveRecipients(selector, agenda(legacy))).toEqual({ kind: "unsupported" });
  });
});
