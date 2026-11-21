import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentContacts, AskInput, RequesterView } from "@team-31/protocol";
import { createMessageFlow, type Intent, type InterpretMessage, type TurnContext, type TurnState, type TurnStore } from "./index.js";

const ana = "ana.soto@sideband.app", second = "ana.vera@sideband.app";
const circle = "69a03cbd-6881-48c0-83f0-b49f8336377e";
const directory: AgentContacts = {
  contacts: [ana, second].map(address => ({ address, tags: ["friend"], displayName: "Ana", theyShare: [], youShare: [] })),
  circles: [{ id: circle, name: "Fútbol", members: [ana, second, ana] }],
};
const askAna: Intent = { action: "ask", selector: { scope: "friend", count: "one", person: "Ana" },
  tool: "interest_check", args: { interest: "cerámica" } };
function harness(interpret: InterpretMessage = async () => structuredClone(askAna)) {
  const states = new Map<string, TurnState>();
  const store: TurnStore = { async run(_owner, token, fn) {
    if (token && !states.has(token)) return undefined;
    const id = randomUUID();
    return fn({ id, continuationId: id, previous: token ? states.get(token) : undefined,
      save: async state => { states.set(id, structuredClone(state)); } });
  } };
  const receipts = new Map<string, RequesterView>();
  const ask = vi.fn(async (input: AskInput): Promise<RequesterView> => {
    const key = input.idempotencyKey!;
    const view = receipts.get(key) ?? { requestId: randomUUID(), to: input.to, tool: input.tool, final: false as const,
      expiresAt: new Date().toISOString(), decision: "pending" as const, waitingFor: "agent" as const };
    receipts.set(key, view);
    return view;
  });
  const context: TurnContext = { userId: "holder", binding: "test", ops: {
    contacts: vi.fn(async () => structuredClone(directory)), ask,
    status: vi.fn(async id => [...receipts.values()].find(r => r.requestId === id)!),
    searchProfiles: vi.fn(async () => []), queryVault: vi.fn(async () => ({ categories: [] })),
  } };
  const flow = createMessageFlow({ interpret, store });
  return { context, ask, receipts, run: (text: string, continuationId?: string) => flow.handleMessage(context, { text, continuationId }) };
}

describe("turnos del titular", () => {
  it.each([["Sin etiqueta", []], ["Equipo", ["equipo"]]])("respeta la elección explícita de etiqueta %s", async (answer, tags) => {
    const intent: Intent = { action: "ask", tool: "connect", args: {}, selector: { scope: "address", count: "one", person: ana } };
    const { run, ask, context } = harness(async () => intent);
    context.ops.invitationTags = async () => ({
      tags: [{ name: "Equipo", id: "equipo", color: "sky", categories: ["availability"], members: [] }], categories: [],
    });
    const first = await run("Invita a " + ana);
    if (first.kind !== "clarification") throw new Error("expected tag selection");
    expect(ask).not.toHaveBeenCalled();
    expect(first.choices?.map(c => c.label)).toEqual(["Sin etiqueta", "Equipo"]);
    expect(first.question).toContain("Equipo — Disponibilidad horaria");
    await run(answer as string, first.continuationId);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ to: ana, tags, tool: "connect" }));
  });

  it("elige dentro de amigos, conserva el interés y consulta el recibo después", async () => {
    const interpret = vi.fn<InterpretMessage>().mockResolvedValueOnce(askAna).mockResolvedValueOnce({ action: "status" });
    const { run, ask, context } = harness(interpret);
    const first = await run("¿A mi amiga Ana le interesa la cerámica?");
    if (first.kind !== "clarification") throw new Error("expected clarification");
    expect(first.choices?.map(c => c.value)).toEqual([ana, second]);
    expect(ask).not.toHaveBeenCalled();
    const selected = await run("la segunda", first.continuationId);
    if (selected.kind !== "requests") throw new Error("expected request");
    expect(ask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      to: second, tool: "interest_check", args: { interest: "cerámica" }, requireRelation: { kind: "contact", tag: "friend" },
    }));
    await run("¿y qué dijo?", selected.continuationId);
    expect(context.ops.status).toHaveBeenCalledWith(selected.items[0]?.requestId);
    expect(interpret).toHaveBeenCalledTimes(2);
  });

  it("una dirección de trabajo no satisface la condición de amistad, tampoco en aclaraciones", async () => {
    const { run, context, ask } = harness();
    context.ops.contacts = async () => ({ contacts: [{ ...directory.contacts[0]!, tags: ["work"] }], circles: [] });
    const result = await run("¿A mi amiga Ana le interesa la cerámica?");
    if (result.kind !== "clarification") throw new Error("expected clarification");
    expect((await run(ana, result.continuationId)).kind).toBe("clarification");
    expect(ask).not.toHaveBeenCalled();
    expect(context.ops.searchProfiles).not.toHaveBeenCalled();
  });

  it("deduplica un círculo y conserva las claves de envío después de una pérdida de respuesta", async () => {
    const { run, ask, receipts } = harness(async () => ({ ...askAna, selector: { scope: "circle", count: "many", circle: "Fútbol" } }));
    const send = ask.getMockImplementation()!;
    ask.mockImplementationOnce(async input => { await send(input); throw new Error("lost response"); });
    const batch = await run("¿En mi círculo Fútbol a alguien le interesa la cerámica?");
    if (batch.kind !== "requests") throw new Error("expected request");
    expect(batch.unconfirmedCount).toBe(1);
    expect(batch.items).toHaveLength(1);
    const retry = await run("reintenta", batch.continuationId);
    if (retry.kind !== "requests") throw new Error("expected recovered requests");
    expect(retry.items).toHaveLength(2);
    expect(receipts.size).toBe(2);
    expect(ask.mock.calls.every(([input]) => input.requireRelation?.kind === "circle" && input.requireRelation.circleId === circle)).toBe(true);
  });

  it("pide el parámetro que falta sin cambiar el destinatario, el ámbito ni la fecha al reanudar", async () => {
    const address = { scope: "address", count: "one", person: ana } as const;
    const intent = { action: "ask", selector: address, tool: "availability", args: { date: "2026-11-22", start: "16:00" } } as const;
    const interpret = vi.fn<InterpretMessage>().mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, selector: { ...address, person: second }, args: { date: "2030-01-01", durationMinutes: 30 } });
    const { run, ask, context } = harness(interpret);
    context.now = new Date("2026-11-21T23:58:00Z"); context.timezone = "UTC";
    const first = await run(ana + " mañana a las 16:00");
    if (first.kind !== "clarification") throw new Error("expected duration");
    expect(first.question).toContain("minutos");
    context.now = new Date("2026-11-22T01:00:00Z");
    await run("media hora", first.continuationId);
    expect(interpret.mock.calls[1]?.[1].at).toBe("2026-11-21T23:58:00.000Z");
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ to: ana, args: { date: "2026-11-22", start: "16:00", durationMinutes: 30, timezone: "UTC" } }));
  });

  it("pide el ámbito cuando se pregunta por alguien y rechaza direcciones ajenas al texto", async () => {
    const interpret = vi.fn<InterpretMessage>()
      .mockResolvedValueOnce({ ...askAna, selector: { scope: "unspecified", count: "many" } })
      .mockResolvedValueOnce({ ...askAna, selector: { scope: "address", count: "one", person: second } });
    const { run, ask } = harness(interpret);
    for (const text of ["¿A alguien le interesa?", "¿Puedes preguntar a Ana?"]) expect((await run(text)).kind).toBe("clarification");
    expect(ask).not.toHaveBeenCalled();
  });

  it("busca perfiles explícitos y lee categorías de bóveda por el ID devuelto", async () => {
    const interpret = vi.fn<InterpretMessage>().mockResolvedValueOnce({ action: "profiles", query: "Ana" })
      .mockResolvedValueOnce({ action: "vault", selector: { scope: "contacts", count: "one", person: ana }, categoryName: "Talleres" });
    const { run, context, ask } = harness(interpret);
    expect((await run("Busca el perfil público de Ana")).kind).toBe("profiles");
    const id1 = randomUUID(), id2 = randomUUID();
    const query = vi.fn(async () => ({ categories: [id1, id2, randomUUID()].map((id, index) => ({ id, name: "Talleres", visibility: "private" as const, canRead: index < 2 })) }));
    context.ops.queryVault = query;
    const selection = await run("Lee Talleres de la bóveda de " + ana);
    if (selection.kind !== "clarification") throw new Error("expected categories");
    expect((await run("2", selection.continuationId)).kind).toBe("vault");
    expect(query).toHaveBeenLastCalledWith({ to: ana, categoryId: id2 });
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    ["¿A mi amiga Ana le gusta la cerámica?", { action: "profiles", query: "Ana" }],
    ["¿A alguien le interesa la cerámica?", { ...askAna, selector: { scope: "contacts", count: "many" } }],
    ["¿A mi colega Ana le gusta la cerámica?", { ...askAna, selector: { scope: "contacts", count: "one", person: "Ana" } }],
    ["¿A solana.soto@sideband.app le gusta la cerámica?", { ...askAna, selector: { scope: "address", count: "one", person: ana } }],
    ["Invita a " + ana, { ...askAna, tool: "connect", args: { share: ["health"] }, selector: { scope: "address", count: "one", person: ana } }],
  ] as [string, Intent][])("se detiene si la interpretación amplía la petición %s", async (text, intent) => {
    const { run, ask, context } = harness(async () => structuredClone(intent));
    expect((await run(text)).kind).toBe("clarification");
    expect(ask).not.toHaveBeenCalled();
    expect(context.ops.searchProfiles).not.toHaveBeenCalled();
  });

  it("resuelve el nombre de un miembro de círculo aunque no esté en la agenda", async () => {
    const { run, context, ask } = harness(async () => ({ ...askAna, selector: { scope: "circle", count: "one", circle: "Fútbol", person: "Paz" } }));
    context.ops.contacts = async () => ({ contacts: [], circles: [{ id: circle, name: "Fútbol", members: [ana], memberNames: { [ana]: "Paz" } }] });
    expect((await run("¿A Paz de mi círculo Fútbol le interesa la cerámica?")).kind).toBe("requests");
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ to: ana, requireRelation: { kind: "circle", circleId: circle } }));
  });

  it("conserva los recibos si el broker rechaza otra llamada del lote", async () => {
    const { run, ask } = harness(async () => ({ ...askAna, selector: { scope: "friend", count: "many" } }));
    ask.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { code: "forbidden" }));
    const reply = await run("¿A mis amigos les interesa la cerámica?");
    expect(reply).toMatchObject({ kind: "requests", unconfirmedCount: 1, items: [{ to: second }] });
  });

  it("relee la bóveda y el ámbito al repetir una entrega; una amistad revocada devuelve vacío", async () => {
    const id = randomUUID();
    let state: TurnState | undefined;
    let replay = false;
    const store: TurnStore = { run: async (_owner, _token, turn) => turn({ id, continuationId: id, previous: state, replay,
      save: async next => { state = structuredClone(next); } }) };
    const interpret = vi.fn<InterpretMessage>().mockResolvedValue({
      action: "vault", selector: { scope: "friend", count: "one", person: ana }, categoryName: "Recetas",
    });
    const { context } = harness();
    const categoryId = randomUUID();
    context.ops.queryVault = vi.fn(async q => ({ categories: [{ id: categoryId, name: "Recetas", visibility: "private" as const, canRead: true,
      ...(q.categoryId ? { entries: [{ label: "sal", value: 3 }] } : {}) }] }));
    const flow = createMessageFlow({ interpret, store });
    const input = { text: "Lee Recetas de la bóveda de mi amiga " + ana };
    expect(await flow.handleMessage(context, input)).toMatchObject({ kind: "vault", data: { categories: [{ entries: [{ value: 3 }] }] } });
    expect(JSON.stringify(state)).not.toContain("sal");
    replay = true;
    context.ops.contacts = async () => ({ contacts: [], circles: [] });
    expect(await flow.handleMessage(context, input)).toEqual({ kind: "vault", data: { categories: [] } });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(context.ops.queryVault).toHaveBeenCalledTimes(2);
    expect(context.ops.ask).not.toHaveBeenCalled();
  });

  it("lee una categoría de todos los contactos que la comparten y lista aparte a los demás", async () => {
    const salud = randomUUID();
    // Without a category name Claude is asked once with the shared names; omitting it asks the holder.
    const interpret = vi.fn<InterpretMessage>().mockResolvedValue({ action: "vault", selector: { scope: "unspecified", count: "many" } });
    const { run, context, ask } = harness(interpret);
    // The second contact lists its «Salud» but does not let the holder read it.
    const queryVault = vi.fn(async ({ to, categoryId }: { to: string; categoryId?: string }) => ({ categories: [{
      id: to === ana ? salud : randomUUID(), name: "Salud", visibility: "private" as const, canRead: to === ana,
      ...(categoryId ? { entries: [{ label: "Tipo de sangre", value: "O negativo" }] } : {}) }] }));
    context.ops.queryVault = queryVault;
    const choice = await run("¿Alguien tiene sangre O negativo?");
    if (choice.kind !== "clarification") throw new Error("expected category choice");
    expect(choice.choices).toEqual([{ label: "Salud", value: "Salud" }]);
    expect(await run("1", choice.continuationId)).toEqual({
      kind: "vaults", categoryName: "Salud", missing: [second],
      items: [{ to: ana, data: { categories: [{ id: salud, name: "Salud", visibility: "private", canRead: true, entries: [{ label: "Tipo de sangre", value: "O negativo" }] }] } }],
    });
    expect(queryVault).toHaveBeenCalledWith({ to: ana, categoryId: salud });
    expect(queryVault).not.toHaveBeenCalledWith(expect.objectContaining({ to: second, categoryId: expect.anything() }));
    expect(ask).not.toHaveBeenCalled();

    // A name that no contact shares as a category is the data: Claude picks among the shared names.
    interpret.mockReset()
      .mockResolvedValueOnce({ action: "vault", selector: { scope: "unspecified", count: "many" }, categoryName: "sangre" })
      .mockResolvedValueOnce({ action: "vault", selector: { scope: "contacts", count: "many" }, categoryName: "Salud" });
    expect(await run("¿Alguno de mis contactos tiene sangre O negativo?")).toMatchObject({ kind: "vaults", categoryName: "Salud", missing: [second] });
    expect(interpret).toHaveBeenLastCalledWith("¿Alguno de mis contactos tiene sangre O negativo?",
      expect.objectContaining({ expected: "categoryName", choices: ["Salud"] }));

    // A pick outside the shared names asks the holder.
    interpret.mockReset()
      .mockResolvedValueOnce({ action: "vault", selector: { scope: "unspecified", count: "many" }, categoryName: "sangre" })
      .mockResolvedValueOnce({ action: "vault", selector: { scope: "contacts", count: "many" }, categoryName: "Finanzas" });
    expect(await run("¿Alguien tiene sangre O negativo?")).toMatchObject({
      kind: "clarification", question: expect.stringContaining("«sangre»"), choices: [{ value: "Salud" }],
    });
  });

  it("al repetir una lectura de varios contactos omite a quien ya no está en el conjunto", async () => {
    const id = randomUUID();
    let state: TurnState | undefined;
    let replay = false;
    const store: TurnStore = { run: async (_owner, _token, turn) => turn({ id, continuationId: id, previous: state, replay,
      save: async next => { state = structuredClone(next); } }) };
    const interpret = vi.fn<InterpretMessage>().mockResolvedValue({
      action: "vault", selector: { scope: "friend", count: "many" }, categoryName: "salud",
    });
    const { context } = harness();
    const ids: Record<string, string> = { [ana]: randomUUID(), [second]: randomUUID() };
    context.ops.queryVault = vi.fn(async ({ to, categoryId }: { to: string; categoryId?: string }) => ({ categories: [{ id: ids[to]!, name: "Salud", visibility: "private" as const, canRead: true,
      ...(categoryId ? { entries: [{ label: "Tipo de sangre", value: "O negativo" }] } : {}) }] }));
    const flow = createMessageFlow({ interpret, store });
    const input = { text: "¿Qué tienen mis amigos en Salud?" };
    expect(await flow.handleMessage(context, input)).toMatchObject({ kind: "vaults", missing: [], items: [{ to: ana }, { to: second }] });
    expect(JSON.stringify(state)).not.toContain("negativo");
    replay = true;
    context.ops.contacts = async () => ({ ...directory, contacts: directory.contacts.filter(({ address }) => address === second) });
    expect(await flow.handleMessage(context, input)).toMatchObject({ kind: "vaults", items: [{ to: second }] });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("lista las bóvedas propias, abre una por nombre y pregunta cuál si el nombre no calza", async () => {
    const health = { id: "health", name: "Salud", description: "Alergias y tratamientos.", visibility: "private" as const, tags: [] };
    const wishes = { id: randomUUID(), name: "Deseos", visibility: "public" as const, tags: [] };
    const opened = { ...health, entries: [{ label: "Alergia", value: "Maní" }], members: [] };
    const interpret = vi.fn<InterpretMessage>()
      .mockResolvedValueOnce({ action: "own_vault" })
      .mockResolvedValueOnce({ action: "own_vault", categoryName: "salud" })
      .mockResolvedValueOnce({ action: "own_vault", categoryName: "viajes" })
      .mockResolvedValueOnce({ action: "own_vault", categoryName: "finanzas" })
      .mockResolvedValueOnce({ action: "own_vault" });
    const { run, context, ask } = harness(interpret);
    const ownVault = vi.fn(async (id?: string) => ({ categories: id ? [opened] : [health, wishes] }));
    context.ops.ownVault = ownVault;

    expect(await run("dime las bóvedas que tengo")).toEqual({ kind: "own_vault", data: { categories: [health, wishes] } });
    expect(await run("¿Qué guardo en mi bóveda de salud?")).toEqual({ kind: "own_vault", data: { categories: [opened] } });
    expect(ownVault).toHaveBeenLastCalledWith("health");

    const choice = await run("abre mi bóveda de viajes");
    if (choice.kind !== "clarification") throw new Error("expected own categories");
    expect(choice.choices).toEqual([{ label: "Salud", value: "health" }, { label: "Deseos", value: wishes.id }]);
    expect(await run("la primera", choice.continuationId)).toEqual({ kind: "own_vault", data: { categories: [opened] } });

    // A category name the holder did not write falls back to the list.
    expect(await run("¿qué tengo guardado?")).toEqual({ kind: "own_vault", data: { categories: [health, wishes] } });
    // Without vault words the reading is not trusted.
    expect((await run("¿cómo estás?")).kind).toBe("clarification");
    expect(interpret).toHaveBeenCalledTimes(5);
    expect(ask).not.toHaveBeenCalled();
    expect(context.ops.contacts).not.toHaveBeenCalled();
  });

  it("repite el recibo de un envío ya completado con el scope ask", async () => {
    const { context } = harness();
    let previous: TurnState | undefined;
    const id = randomUUID();
    let replay = false;
    const store: TurnStore = { run: async (_owner, _token, fn) => fn({ id, continuationId: id,
      previous, replay, save: async state => { previous = structuredClone(state); } }) };
    const interpret = vi.fn<InterpretMessage>().mockResolvedValue({ ...askAna,
      selector: { scope: "friend", count: "one", person: ana } });
    const flow = createMessageFlow({ interpret, store });
    const input = { text: "¿A mi amiga " + ana + " le interesa la cerámica?" };
    const first = await flow.handleMessage(context, input);
    expect(first.kind).toBe("requests");
    replay = true;
    await expect(flow.handleMessage(context, input)).resolves.toEqual(first);
    expect(context.ops.ask).toHaveBeenCalledTimes(1);
    expect(context.ops.status).not.toHaveBeenCalled();
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("avanza en ventanas de cuota sin reenviar solicitudes confirmadas con un token solo ask", async () => {
    const { run, ask, context } = harness(async () => ({
      ...askAna, selector: { scope: "friend", count: "many" },
    }));
    const addresses = Array.from({ length: 6 }, (_, i) => "amigo" + i + "@sideband.app");
    context.ops.contacts = async () => ({ contacts: addresses.map(address => ({ address, tags: ["friend"], theyShare: [], youShare: [] })), circles: [] });
    const submit = ask.getMockImplementation()!;
    const confirmed = new Set<string>();
    let budget = 2;
    ask.mockImplementation(async input => {
      expect(confirmed.has(input.to)).toBe(false);
      if (budget-- <= 0) throw Object.assign(new Error("rate_limited"), { code: "rate_limited" });
      confirmed.add(input.to);
      return submit(input);
    });
    let reply = await run("¿A mis amigos les interesa la cerámica?");
    for (const remaining of [4, 2]) {
      if (reply.kind !== "requests") throw new Error("expected receipts");
      expect(reply.unconfirmedCount).toBe(remaining);
      budget = 2;
      reply = await run("continuar", reply.continuationId);
    }
    expect(reply).toMatchObject({ kind: "requests", unconfirmedCount: 0 });
    if (reply.kind === "requests") expect(reply.items).toHaveLength(6);
    expect(confirmed.size).toBe(6);
    expect(context.ops.status).not.toHaveBeenCalled();
  });

  it("la fecha relativa usa el huso local aunque el titular lo aclare después de medianoche", async () => {
    const selector = { scope: "address", count: "one", person: ana } as const;
    const intent = { action: "ask", tool: "availability", selector, args: { date: "2026-11-23", start: "15:00", durationMinutes: 30 } } as const;
    const parse = vi.fn<InterpretMessage>().mockResolvedValueOnce(intent).mockResolvedValueOnce({ ...intent, args: { timezone: "America/Santiago" } });
    const { run, ask, context } = harness(parse);
    context.now = new Date("2026-11-22T01:00:00Z");
    const first = await run("¿Está libre " + ana + " mañana a las 15:00 por media hora?");
    if (first.kind !== "clarification") throw new Error("expected timezone");
    context.now = new Date("2026-11-22T05:00:00Z");
    await run("America/Santiago", first.continuationId);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ args: { timezone: "America/Santiago", date: "2026-11-22", start: "15:00", durationMinutes: 30 } }));
  });

  it("consulta la bóveda de alguien del círculo solo si también es contacto", async () => {
    const { run, context } = harness(async () => ({
      action: "vault", selector: { scope: "circle", count: "one", circle: "Fútbol", person: "Paz" },
    }));
    context.ops.contacts = async () => ({ contacts: [], circles: [{ id: circle, name: "Fútbol", members: [ana], memberNames: { [ana]: "Paz" } }] });
    expect((await run("Lee la bóveda de Paz de mi círculo Fútbol")).kind).toBe("clarification");
    expect(context.ops.queryVault).not.toHaveBeenCalled();
  });
});
