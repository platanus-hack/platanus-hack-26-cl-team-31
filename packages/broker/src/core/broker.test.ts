import { generateKeyPairSync } from "node:crypto";
import {
  ActivityItem,
  basicSharing,
  contactTags,
  InboxItem,
  RequesterView,
  WAKE_EVENT,
  type AskInput,
  type Grant,
  type GrantInput,
  type Principal,
  type ReplyInput,
  type Sharing,
  type WakeTarget,
  type Waker,
} from "@team-31/protocol";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { createWaker } from "@team-31/wake";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBroker, createMemoryStore, type BrokerCore, type BrokerDeps } from "../index.js";
import { createOwnerRuntime, localQuestionSource, localReadTool } from "@team-31/broker-client";
import { deriveNonce, verifyJson } from "./crypto.js";

const principals: Record<"alice" | "bruno" | "carla", Principal> = {
  alice: { userId: "alice", agentId: "alice-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
  bruno: { userId: "bruno", agentId: "bruno-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
  carla: { userId: "carla", agentId: "carla-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
};
const { alice, bruno, carla } = principals;
const availability: AskInput = {
  to: "bruno@sideband.app", tool: "availability", purpose: "Coordinar", args: {
    date: "2026-11-26", start: "09:00", durationMinutes: 30, timezone: "America/Santiago",
  },
};
const webhook: WakeTarget = { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_demo" };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const nonceKey = new Uint8Array(32).fill(4);
const toAlice: GrantInput = { grantee: "alice@sideband.app", category: "availability" };

let now: Date;
let broker: BrokerCore;
let aliceGrant: Grant;
let deps: BrokerDeps;
const verifyCallback = vi.fn<Waker["verifyCallback"]>();
const wake = vi.fn<Waker["wake"]>();

beforeEach(async () => {
  now = new Date("2026-11-21T15:00:00Z");
  verifyCallback.mockReset().mockResolvedValue({ ok: true });
  wake.mockReset().mockResolvedValue({ ok: true, retryable: false, ms: 1 });
  deps = {
    store: createMemoryStore(),
    waker: { wake, verifyCallback },
    clock: { now: () => now },
    signingKey: privateKey,
    nonceKey,
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 10_000, 30_000], addressDomain: "sideband.app" },
  };
  broker = createBroker(deps);
  for (const p of Object.values(principals)) {
    await broker.owner.claimAddress(p, p.userId);
  }
  aliceGrant = await broker.owner.setGrant(bruno, toAlice);
});

function advance(ms: number): void {
  now = new Date(now.getTime() + ms);
}

it("reclama solo avisos que puede iniciar y entrega los restantes en el próximo tick", async () => {
  await broker.agent.connectWake(bruno, webhook);
  for (let i = 0; i < 10; i++) await askAvailability();
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  wake.mockImplementation(async () => { await promise; return { ok: true, retryable: false, ms: 1 }; });
  const first = broker.tick(now);
  try {
    await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(8));
  } finally { resolve(); }
  expect(await first).toMatchObject({ wakesOk: 8 });
  expect(await broker.tick(now)).toMatchObject({ wakesOk: 2 });
});

it("guarda desde el agente y revoca desde el dashboard sin alterar el permiso de otro grupo", async () => {
  const p: Principal = { ...bruno, scopes: ["sideband:vault"] };
  await expect(broker.agent.changeVault(bruno, { action: "create", name: "Deseos" })).rejects.toMatchObject({ code: "forbidden" });
  const { categoryId } = await broker.agent.changeVault(p, { action: "create", name: "Deseos" });
  const put = { action: "put_entry", categoryId, label: "Regalo", value: "Cafetera" } as const;
  await broker.agent.changeVault(p, put);
  expect((await broker.owner.vault(bruno)).categories[0]).toMatchObject({ groups: [], entries: [{ label: "Regalo", value: "Cafetera" }] });
  for (const [recipient, tag] of [[alice, "friend"], [carla, "family"]] as const) {
    const invite = await broker.owner.connect(bruno, `${recipient.userId}@sideband.app`, [], tag);
    await broker.owner.answerInvitation(recipient, invite.requestId, { accept: true, share: [] });
    await broker.owner.changeVault(bruno, { action: "set_group", categoryId, group: tag, allowed: true });
  }
  const query = { categoryId, to: "bruno@sideband.app" };
  expect((await broker.agent.queryVault(alice, query)).categories[0]?.entries).toHaveLength(1);
  await broker.agent.changeVault(p, { ...put, value: "Molino" });
  await broker.owner.changeVault(bruno, { action: "set_group", categoryId, group: "friend", allowed: false });
  expect(await broker.agent.queryVault(alice, query)).toEqual({ categories: [] });
  expect((await broker.agent.queryVault(carla, query)).categories[0]?.entries).toEqual([{ label: "Regalo", value: "Molino" }]);
  await broker.agent.changeVault(p, { action: "delete_entry", categoryId, label: put.label });
  expect((await broker.agent.queryVault(carla, query)).categories[0]?.entries).toEqual([]);
});

async function askAvailability() {
  return broker.agent.ask(alice, availability);
}

// A request waits for the owner only after the recipient's agent escalates it.
async function askAndEscalate() {
  const view = await askAvailability();
  await broker.agent.reply(bruno, { ...await inboxItem(bruno, view.requestId), outcome: "needs_owner" });
  return view;
}

async function inboxItem(p = bruno, requestId?: string): Promise<InboxItem> {
  const item = (await broker.agent.inbox(p)).find((entry) => requestId === undefined || entry.requestId === requestId);
  return InboxItem.parse(item);
}

async function expectFinal(
  p: Principal, requestId: string, decision: "allow" | "deny" | "unanswered", outcome: string, result?: unknown,
) {
  const view = RequesterView.parse(await broker.agent.status(p, requestId));
  expect(view).toMatchObject({ final: true, decision });
  if (view.final) {
    expect(await verifyJson(publicKey, { requestId, outcome, result }, view.signature)).toBe(true);
  }
  return view;
}

describe("contrato del broker", () => {
  it("firma el sobre de la solicitud y avisa al agente solo cuando hay un grant", async () => {
    const view = await askAvailability();
    const row = await deps.store.tx((tx) => tx.getRequest(view.requestId));
    expect(await verifyJson(publicKey, {
      id: view.requestId, from: "alice@sideband.app", to: availability.to, tool: "availability",
      args: availability.args, createdAt: now.toISOString(), expiresAt: view.expiresAt,
    }, row!.envelopeSignature)).toBe(true);
    await broker.agent.connectWake(bruno, webhook);
    expect((await broker.tick(now)).wakesOk).toBe(1);

    wake.mockClear();
    expect(await broker.agent.ask(carla, availability)).toMatchObject({ final: true, decision: "deny" });
    expect((await broker.tick(now)).wakesOk).toBe(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it("valida nonce y esquema, filtra el resultado y admite una sola respuesta", async () => {
    const pending = await askAvailability();
    expect(pending).toMatchObject({ final: false, waitingFor: "agent" });
    const item = await inboxItem(bruno, pending.requestId);
    expect(item).toMatchObject({
      requestId: pending.requestId, allowedFields: ["available", "freeSlots"],
      ownerAuthorization: { rule: "Permiso para la categoría Disponibilidad horaria", guidance: "", verifiedBy: "broker" },
      senderMessage: { text: "", purpose: "Coordinar", trusted: false },
    });
    await expect(broker.agent.reply(bruno, { ...item, nonce: "abcdefghijklmnop", outcome: "no_data" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.reply(bruno, { ...item, outcome: "answered", result: { freeSlots: ["10:00-10:30"] } }))
      .rejects.toMatchObject({ code: "invalid_input" });

    const reply = { ...item, outcome: "answered" as const, result: {
      available: true, freeSlots: ["10:00-10:30"], privateNote: "texto privado",
    } };
    expect(await broker.agent.reply(bruno, reply)).toMatchObject({
      status: "answered", deliveredFields: ["available", "freeSlots"], droppedFields: ["privateNote"],
    });
    await expect(broker.agent.reply(bruno, reply)).rejects.toMatchObject({ code: "conflict" });
    const result = { available: true, freeSlots: ["10:00-10:30"] };
    const view = await expectFinal(alice, item.requestId, "allow", "answered", result);
    expect(view).toMatchObject({ result });
    expect(JSON.stringify(view)).not.toContain("privateNote");
    const sent = ActivityItem.parse((await broker.owner.activity(alice))[0]);
    expect(sent).toMatchObject({ direction: "sent", droppedFields: [] });
    expect(sent).not.toHaveProperty("decisionReason");
    const events = await deps.store.tx((tx) => tx.listEvents([item.requestId]));
    expect(events.filter((event) => event.code).map((event) => event.code)).toEqual(["forbidden", "invalid_input", "conflict"]);
  });

  it("rechaza una respuesta malformada antes de buscar la solicitud", async () => {
    const malformed = { requestId: "missing", nonce: "nonce", outcome: "answered" } as unknown as ReplyInput;
    await expect(broker.agent.reply(bruno, malformed)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("entrega no_data firmado y muestra el motivo exclusivamente al dueño destinatario", async () => {
    const pending = await askAvailability();
    const item = await inboxItem(bruno, pending.requestId);
    await broker.agent.reply(bruno, { ...item, outcome: "no_data", internalReason: "Motivo reservado" });
    const view = await expectFinal(alice, item.requestId, "unanswered", "no_data");
    expect(view).not.toHaveProperty("internalReason");
    const sender = (await broker.owner.activity(alice))[0];
    const recipient = (await broker.owner.activity(bruno))[0];
    expect(sender).not.toHaveProperty("internalReason");
    expect(recipient).toMatchObject({
      direction: "received", internalReason: "Motivo reservado",
      events: [{ kind: "received" }, { kind: "permission" }, { kind: "response" }, { kind: "delivery" }],
    });
    expect(await broker.owner.activity(carla)).toEqual([]);
  });

  it("amplía el plazo en la primera escalación y reduce los campos al aprobar una vez", async () => {
    const pending = await askAvailability();
    const item = await inboxItem(bruno, pending.requestId);
    advance(10_000);
    expect(await broker.agent.reply(bruno, { ...item, outcome: "needs_owner" })).toMatchObject({ status: "awaiting_owner" });
    expect(await broker.agent.status(alice, item.requestId)).toMatchObject({
      final: false, waitingFor: "owner", expiresAt: new Date(now.getTime() + 900_000).toISOString(),
    });
    expect(await broker.owner.pending(bruno)).toMatchObject([{ requestId: item.requestId, escalated: true }]);
    expect(await broker.owner.pending(alice)).toEqual([]);
    await expect(broker.owner.decide(alice, item.requestId, { kind: "approve_once" })).rejects.toMatchObject({ code: "not_found" });
    await broker.owner.decide(bruno, item.requestId, { kind: "approve_once" });
    expect(await inboxItem(bruno, item.requestId)).toMatchObject({ allowedFields: ["available"] });
    await expect(broker.agent.reply(bruno, { ...item, outcome: "needs_owner" })).rejects.toMatchObject({ code: "conflict" });
    await broker.agent.reply(bruno, { ...item, outcome: "declined" });
    expect(await expectFinal(alice, item.requestId, "deny", "deny")).not.toHaveProperty("outcome");
  });

  it("permite una respuesta manual del dueño cuando su agente escala la solicitud", async () => {
    await broker.owner.setGrant(bruno, { grantee: "carla@sideband.app", category: "general" });
    const pending = await broker.agent.ask(carla, {
      to: availability.to, tool: "question", args: { text: "¿Disponible?", category: "general" }, purpose: "Coordinar",
    });
    await broker.agent.reply(bruno, { ...await inboxItem(bruno, pending.requestId), outcome: "needs_owner" });
    expect(await broker.owner.pending(bruno)).toMatchObject([{
      requestId: pending.requestId, escalated: true, senderMessage: { text: "¿Disponible?", purpose: "Coordinar", trusted: false },
    }]);
    await expect(broker.owner.decide(bruno, pending.requestId, { kind: "answer", result: { available: true } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await broker.owner.decide(bruno, pending.requestId, { kind: "answer", result: { answer: "Sí" } });
    expect(await expectFinal(carla, pending.requestId, "allow", "answered", { answer: "Sí" })).toMatchObject({ result: { answer: "Sí" } });
  });

  it("devuelve denegaciones firmadas sin motivos cuando falta el grant o la dirección no existe", async () => {
    for (const [sender, input] of [
      [carla, availability],
      [alice, { ...availability, to: "unknown@sideband.app" }],
      [alice, { to: availability.to, tool: "profile", args: {} }],
    ] as const) {
      const denied = await broker.agent.ask(sender, input);
      expect(denied).toEqual({
        requestId: expect.any(String), to: input.to, tool: input.tool, expiresAt: expect.any(String),
        final: true, decision: "deny", signature: expect.any(String),
      });
      await expectFinal(sender, denied.requestId, "deny", "deny");
    }
    expect(await broker.owner.activity(alice)).not.toEqual(expect.arrayContaining([expect.objectContaining({ decisionReason: expect.anything() })]));
    await expect(broker.agent.ask(alice, { ...availability, to: "alice@sideband.app" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("aislamiento y concurrencia", () => {
  it("aísla 80 solicitudes concurrentes entre tres usuarios", async () => {
    for (const p of Object.values(principals)) {
      for (const { userId } of Object.values(principals).filter((other) => other !== p)) {
        await broker.owner.setGrant(p, { grantee: `${userId}@sideband.app`, category: "general" });
      }
    }
    const users = [alice, bruno, carla] as const;
    const rows = await Promise.all(Array.from({ length: 80 }, async (_, number) => {
      const from = users[number % users.length]!;
      const to = users[(number + 1) % users.length]!;
      const text = `Solicitud ${number}`;
      const view = await broker.agent.ask(from, { to: `${to.userId}@sideband.app`, tool: "question", args: { text, category: "general" } });
      return { from, to, text, requestId: view.requestId };
    }));
    const byUser = await Promise.all(users.map(async (user) => {
      const inbox = await broker.agent.inbox(user);
      expect(inbox.map(({ requestId }) => requestId).sort()).toEqual(rows.filter(({ to }) => to === user).map(({ requestId }) => requestId).sort());
      return [user.userId, new Map(inbox.map((item) => [item.requestId, item]))] as const;
    }));
    const inboxes = new Map(byUser);
    await Promise.all(rows.map(async ({ from, to, text, requestId }) => {
      const item = inboxes.get(to.userId)!.get(requestId)!;
      expect(item.senderMessage).toMatchObject({ text, trusted: false });
      await broker.agent.reply(to, { ...item, outcome: "answered", result: { answer: text } });
      expect(await broker.agent.status(from, requestId)).toMatchObject({ result: { answer: text } });
    }));
  });

  it("exige scopes y participantes aun con un nonce correcto", async () => {
    const view = await askAvailability();
    const item = await inboxItem(bruno, view.requestId);
    await expect(broker.agent.ask({ ...alice, scopes: [] }, availability)).rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.inbox({ ...bruno, scopes: [] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.reply({ ...bruno, scopes: [] }, { ...item, outcome: "no_data" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.status({ ...alice, scopes: [] }, view.requestId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.reply(carla, { ...item, outcome: "no_data" })).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.agent.status(bruno, view.requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.agent.status(carla, view.requestId)).rejects.toMatchObject({ code: "not_found" });
    expect(await broker.agent.status(alice, view.requestId)).toMatchObject({ final: false });
  });

  it("da una sola victoria a dos respuestas simultáneas de agentes del mismo dueño", async () => {
    const view = await askAvailability();
    const item = await inboxItem(bruno, view.requestId);
    const outcomes = await Promise.allSettled([
      broker.agent.reply(bruno, { ...item, outcome: "no_data" }),
      broker.agent.reply({ ...bruno, agentId: "another-bot" }, { ...item, outcome: "declined" }),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes).toContainEqual({ status: "rejected", reason: expect.objectContaining({ code: "conflict" }) });
    const events = await deps.store.tx((tx) => tx.listEvents([view.requestId]));
    expect(events.filter(({ kind }) => kind === "delivery")).toHaveLength(1);
  });
});

describe("cierre y avisos", () => {
  it("atiende avisos entre lotes de solicitudes vencidas", async () => {
    for (let i = 0; i < 101; i++) await askAvailability();
    await broker.tick(now);
    await broker.tick(now);
    advance(900_000);
    await broker.agent.inbox(bruno);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    const live = await askAvailability();
    expect(await broker.tick(now)).toMatchObject({ expired: 100, wakesOk: 1 });
    expect(wake.mock.calls.map(([, notice]) => notice.requestId)).toContain(live.requestId);
    expect((await broker.tick(now)).expired).toBe(1);
  });

  it("vence solicitudes de agente y dueño en el plazo exacto", async () => {
    const agent = await askAvailability();
    const owner = await askAndEscalate();
    advance(900_000);
    expect(await broker.tick(now)).toEqual({ expired: 2, wakesOk: 0, wakesRetried: 0, wakesFailed: 0 });
    await expectFinal(alice, agent.requestId, "unanswered", "expired");
    await expectFinal(alice, owner.requestId, "unanswered", "expired");
    expect(wake).not.toHaveBeenCalled();
  });

  it("conserva el cierre firmado cuando una respuesta o aprobación llega vencida", async () => {
    const agent = await askAvailability();
    const item = await inboxItem(bruno, agent.requestId);
    const owner = await askAndEscalate();
    advance(900_000);
    await expect(broker.agent.reply(bruno, { ...item, outcome: "no_data" })).rejects.toMatchObject({ code: "expired" });
    await expect(broker.owner.decide(bruno, owner.requestId, { kind: "approve_once" })).rejects.toMatchObject({ code: "expired" });
    await expectFinal(alice, agent.requestId, "unanswered", "expired");
    await expectFinal(alice, owner.requestId, "unanswered", "expired");
    expect((await broker.tick(now)).expired).toBe(0);
  });

  it("reintenta dos veces y cierra tras el tercer aviso fallido, sin enviar contenido", async () => {
    await broker.agent.inbox(bruno);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    wake.mockResolvedValue({ ok: false, retryable: true, status: 500, ms: 1, detail: "diagnóstico sensible" });
    const view = await askAvailability();
    expect((await broker.tick(now)).wakesRetried).toBe(1);
    advance(9_999);
    expect((await broker.tick(now)).wakesRetried).toBe(0);
    advance(1);
    expect((await broker.tick(now)).wakesRetried).toBe(1);
    advance(30_000);
    expect((await broker.tick(now)).wakesFailed).toBe(1);
    await expectFinal(alice, view.requestId, "unanswered", "delivery_failed");
    expect(wake.mock.calls).toEqual([1, 2, 3].map((attempt) => [
      webhook,
      { requestId: view.requestId, event: WAKE_EVENT },
      { attempt, queueWaitMs: 0, final: attempt === 3, userId: bruno.userId, agentId: bruno.agentId },
    ]));
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ lastWakeAt: now.toISOString(), wakeKind: "standard_webhook" });
    expect(JSON.stringify(await broker.owner.activity(bruno))).not.toContain("diagnóstico sensible");
  });

  it("cierra fallos irreversibles de aviso y trata polling como entrega exitosa", async () => {
    const first = await askAvailability();
    expect((await broker.tick(now)).wakesOk).toBe(1);
    expect(wake).not.toHaveBeenCalled();
    expect(await broker.agent.status(alice, first.requestId)).toMatchObject({ waitingFor: "agent" });
    await broker.agent.inbox(bruno);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    wake.mockResolvedValue({ ok: false, retryable: false, status: 401, ms: 1 });
    const second = await askAvailability();
    expect((await broker.tick(now)).wakesFailed).toBe(1);
    expect(wake).toHaveBeenCalledTimes(1);
    await expectFinal(alice, second.requestId, "unanswered", "delivery_failed");
  });

  it("espera a los avisos en curso antes de propagar el error de otro aviso", async () => {
    await broker.agent.connectWake(bruno, webhook);
    const failed = await askAvailability();
    await askAvailability();
    const tx = deps.store.tx.bind(deps.store);
    vi.spyOn(deps.store, "tx").mockImplementation((run) => tx((store) => run({
      ...store,
      getRequest(id, ...args) {
        if (id === failed.requestId) throw new Error("Error de lectura");
        return store.getRequest(id, ...args);
      },
    })));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    wake.mockImplementationOnce(async () => {
      await pending;
      return { ok: true, retryable: false, ms: 1 };
    });
    const settled = vi.fn();
    const ticking = broker.tick(now).catch(settled);
    try {
      await vi.waitFor(() => expect(wake).toHaveBeenCalledOnce());
      expect(settled).not.toHaveBeenCalled();
    } finally {
      release();
      await ticking;
    }
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ message: "Error de lectura" }));
  });

  it("preserva una respuesta que llega mientras dos trabajadores compiten por el aviso", async () => {
    await broker.agent.inbox(bruno);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let finishWake!: (result: Awaited<ReturnType<Waker["wake"]>>) => void;
    const finished = new Promise<Awaited<ReturnType<Waker["wake"]>>>((resolve) => { finishWake = resolve; });
    wake.mockImplementationOnce(() => {
      markStarted();
      return finished;
    });
    const view = await askAvailability();
    const ticking = broker.tick(now);
    await started;
    expect((await broker.tick(now)).wakesFailed).toBe(0);
    const item = await inboxItem(bruno, view.requestId);
    await broker.agent.reply(bruno, { ...item, outcome: "no_data" });
    finishWake({ ok: false, retryable: false, ms: 1 });
    expect((await ticking).wakesFailed).toBe(0);
    expect(wake).toHaveBeenCalledTimes(1);
    await expectFinal(alice, view.requestId, "unanswered", "no_data");
  });

  it("ignora avisos de una etapa anterior de la misma solicitud", async () => {
    await broker.agent.inbox(bruno);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    const view = await askAvailability();
    const item = await inboxItem(bruno, view.requestId);
    await broker.agent.reply(bruno, { ...item, outcome: "needs_owner" });
    await broker.owner.decide(bruno, view.requestId, { kind: "approve_once" });
    expect((await broker.tick(now)).wakesOk).toBe(1);
    expect(wake).toHaveBeenCalledExactlyOnceWith(webhook, { requestId: view.requestId, event: WAKE_EVENT }, expect.objectContaining({ attempt: 1, final: false, userId: bruno.userId }));
  });
});

describe("conexiones y prueba de aviso", () => {
  it("registra perezosamente, conserva revocación y verifica solo el agente seleccionado", async () => {
    const another = { ...bruno, agentId: "other-bot" };
    await broker.agent.connect(bruno);
    await expect(broker.agent.connect(another)).rejects.toMatchObject({ code: "conflict" });
    expect(await broker.owner.agents(bruno)).toHaveLength(1);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    const ping = await broker.owner.ping(bruno, bruno.agentId);
    await expect(broker.agent.inbox(another)).rejects.toMatchObject({ code: "conflict" });
    const item = await inboxItem(bruno, ping.requestId);
    expect(item).toMatchObject({ from: "system@sideband.app", tool: "question", senderMessage: { trusted: false } });
    await expect(broker.agent.reply(another, { ...item, nonce: deriveNonce(nonceKey, ping.requestId), outcome: "no_data" }))
      .rejects.toMatchObject({ code: "conflict" });
    await broker.tick(now);
    expect(wake).toHaveBeenCalledExactlyOnceWith(webhook, { requestId: ping.requestId, event: WAKE_EVENT }, expect.objectContaining({ attempt: 1, final: false, userId: bruno.userId }));
    await broker.agent.reply(bruno, { ...item, outcome: "no_data" });
    const agents = await broker.owner.agents(bruno);
    expect(agents.find(({ agentId }) => agentId === bruno.agentId)).toMatchObject({ verifiedAt: now.toISOString(), wakeKind: "standard_webhook" });
    expect(agents.find(({ agentId }) => agentId === another.agentId)?.verifiedAt).toBeUndefined();
    await expect(broker.owner.setWake(carla, bruno.agentId, { kind: "none" })).rejects.toMatchObject({ code: "not_found" });

    const pending = await askAvailability();
    const pendingItem = await inboxItem(bruno, pending.requestId);
    await broker.owner.revokeAgent(bruno, bruno.agentId);
    await broker.agent.connect(another);
    await expect(broker.agent.reply(bruno, { ...pendingItem, outcome: "no_data" })).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.agent.inbox(bruno)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.agent.connectWake(bruno, { kind: "none" })).rejects.toMatchObject({ code: "not_found" });
    expect((await broker.owner.agents(bruno)).find(({ agentId }) => agentId === bruno.agentId)).toMatchObject({
      revokedAt: now.toISOString(), wakeKind: "standard_webhook",
    });
  });

  it("verifica callbacks antes de guardar y limita la desconexión a la suscripción propia", async () => {
    const target: WakeTarget = {
      kind: "mcp_events", callbackUrl: "https://example.com/mcp", secret: "whsec_demo", subscriptionId: "sub", refreshBefore: null,
    };
    const limited: Principal = { ...bruno, scopes: ["sideband:status"] };
    await expect(broker.agent.connectWake(limited, target)).rejects.toMatchObject({ code: "forbidden" });
    expect(verifyCallback).not.toHaveBeenCalled();
    verifyCallback.mockResolvedValueOnce({ ok: false, reason: "challenge_failed" });
    await expect(broker.agent.connectWake(bruno, target)).rejects.toMatchObject({
      code: "invalid_input", reason: "challenge_failed", message: "challenge_failed",
    });
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ wakeKind: "none" });
    const connected = await broker.agent.connectWake(bruno, target);
    expect(verifyCallback).toHaveBeenLastCalledWith(target);
    expect(connected).toMatchObject({ wakeKind: "mcp_events" });
    expect(JSON.stringify(connected)).not.toContain(target.secret);
    await expect(broker.agent.disconnectWake(limited, target.subscriptionId)).rejects.toMatchObject({ code: "forbidden" });
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ wakeKind: "mcp_events" });
    await expect(broker.agent.disconnectWake(carla, target.subscriptionId)).rejects.toMatchObject({ code: "not_found" });
    await broker.agent.disconnectWake(bruno, target.subscriptionId);
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ wakeKind: "none" });
  });
});


describe("ejecución en el runtime del titular", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  const notice = (requestId: string) => ({ event: WAKE_EVENT, requestId });
  const revoke = () => broker.owner.revokeGrant(bruno, aliceGrant.id);

  it("un permiso de intereses no autoriza una pregunta de otra categoría ni despierta al titular", async () => {
    await revoke();
    await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", category: "interests" });
    await broker.agent.connectWake(bruno, webhook);
    const { tools } = await broker.agent.capabilities(alice, availability.to);
    expect(tools.map(({ tool, categories }) => [tool, categories])).toEqual([
      ["question", ["interests"]], ["interest_check", ["interests"]], ["connect", []],
    ]);
    for (const category of ["health", "general"] as const) {
      const view = await broker.agent.ask(alice, {
        to: availability.to, tool: "question", args: { text: "¿Qué medicamentos toma Bruno?", category },
      });
      expect(view).toEqual(await expectFinal(alice, view.requestId, "deny", "deny"));
      expect(view).not.toHaveProperty("result");
    }
    await broker.tick(now);
    expect(wake).not.toHaveBeenCalled();
    expect(await broker.agent.inbox(bruno)).toEqual([]);
  });

  it("una pregunta lleva su categoría al agente del titular y se revoca con ella", async () => {
    const health = await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", category: "health" });
    const args = { text: "¿Bruno es alérgico a algo?", category: "health" } as const;
    const pending = await broker.agent.ask(alice, { to: availability.to, tool: "question", args });
    expect(await inboxItem(bruno, pending.requestId)).toMatchObject({
      tool: "question", args, allowedFields: ["answer"],
      ownerAuthorization: { rule: "Permiso para la categoría Salud", guidance: expect.stringContaining("declined") },
    });
    await broker.owner.revokeGrant(bruno, health.id);
    expect(await broker.agent.status(alice, pending.requestId)).toMatchObject({ final: true, decision: "deny" });
    expect(await broker.agent.ask(alice, availability)).toMatchObject({ final: false, waitingFor: "agent" });
  });

  it("una pregunta solo lee respuestas preparadas en la fuente autorizada", async () => {
    await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", category: "interests" });
    const interests = vi.fn(async () => new Map([["¿Qué te gusta?", "Cerámica"]]));
    const health = vi.fn(async () => new Map([["¿Alguna alergia?", "Dato privado"]]));
    const run = createOwnerRuntime(broker.agent, bruno, [
      localQuestionSource("health", health), localQuestionSource("interests", interests),
    ]);
    for (const [text, outcome] of [["¿Alguna alergia?", "no_data"], ["¿Qué te gusta?", "answered"]] as const) {
      const request = await broker.agent.ask(alice, { to: availability.to, tool: "question", args: { text, category: "interests" } });
      await run(notice(request.requestId));
      const view = await broker.agent.status(alice, request.requestId);
      expect(view).toMatchObject({ outcome, ...(outcome === "answered" && { result: { answer: "Cerámica" } }) });
      expect(JSON.stringify(view)).not.toContain("Dato privado");
    }
    expect(interests).toHaveBeenCalledWith("alice@sideband.app");
    expect(health).not.toHaveBeenCalled();
  });

  it("ofrece los permisos del titular junto con la invitación a conectar", async () => {
    const { tools } = await broker.agent.capabilities(alice, availability.to);
    expect(tools).toMatchObject([
      {
        tool: "availability", execution: "owner_runtime", inputSchema: { type: "object" },
        allowedFields: ["available", "freeSlots"], categories: ["availability"],
      },
      { tool: "question", allowedFields: ["answer"], categories: ["availability"] },
      { tool: "connect", execution: "owner_runtime", allowedFields: ["accepted"], categories: [] },
    ]);
    await revoke();
    expect(await broker.agent.capabilities(alice, availability.to))
      .toMatchObject({ tools: [{ tool: "connect", allowedFields: ["accepted"] }] });
  });

  it("un aviso tardío tras una revocación no ejecuta el conector", async () => {
    const request = await askAvailability();
    await revoke();
    const read = vi.fn(async () => ({ available: true }));
    const onWake = createOwnerRuntime(broker.agent, bruno, [localReadTool("availability", read)]);
    await onWake(notice(request.requestId));
    expect(read).not.toHaveBeenCalled();
    expect(await broker.agent.status(alice, request.requestId)).toMatchObject({ decision: "deny" });
  });

  it("revocar mientras el conector lee impide entregar su respuesta", async () => {
    const request = await askAvailability();
    const onWake = createOwnerRuntime(broker.agent, bruno, [localReadTool("availability", async () => {
      await revoke();
      return { available: true };
    })]);
    await expect(onWake(notice(request.requestId))).rejects.toMatchObject({ code: "conflict" });
    expect(await broker.agent.status(alice, request.requestId)).toMatchObject({ decision: "deny" });
  });

  it("requiere una herramienta registrada por el titular además del permiso del broker", async () => {
    const request = await askAvailability();
    const onWake = createOwnerRuntime(broker.agent, bruno, []);
    await expect(onWake({ ...notice(request.requestId), tool: "question" })).rejects.toThrow();
    await onWake(notice(request.requestId));
    expect(await broker.agent.status(alice, request.requestId)).toMatchObject({ decision: "deny" });
  });

  it("shares a failed wake with overlapping callers and retries the next delivery", async () => {
    const request = await askAvailability();
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ available: true });
    const onWake = createOwnerRuntime(broker.agent, bruno, [localReadTool("availability", read)]);
    const wake = notice(request.requestId);
    const settled = await Promise.allSettled([onWake(wake), onWake(wake)]);
    expect(settled).toMatchObject([{ status: "rejected", reason: { message: "offline" } }, { status: "rejected", reason: { message: "offline" } }]);
    expect(read).toHaveBeenCalledOnce();
    await onWake(wake);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("filtra la salida antes de enviarla al broker y procesa un aviso repetido una sola vez", async () => {
    const request = await askAvailability();
    const reply = vi.fn(broker.agent.reply);
    const read = vi.fn(async () => ({ available: true, privateNote: "texto privado" }));
    const onWake = createOwnerRuntime({ inbox: broker.agent.inbox, reply }, bruno, [localReadTool("availability", read)]);
    await Promise.all([onWake(notice(request.requestId)), onWake(notice(request.requestId))]);
    await onWake(notice(request.requestId));
    expect(read).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]?.[1].result).toEqual({ available: true });
    expect(await broker.agent.status(alice, request.requestId)).toMatchObject({ result: { available: true } });
    await revoke();
    expect(await expectFinal(alice, request.requestId, "deny", "deny")).not.toHaveProperty("result");
  });
});

describe("solicitudes de conexión", () => {
  const connect: AskInput = { to: "bruno@sideband.app", tool: "connect", args: {} };
  const friends = async (owner: typeof bruno) => (await broker.owner.contacts(owner)).contacts.map(({ address }) => address);

  async function invite() {
    const request = await broker.agent.ask(carla, connect);
    const item = await inboxItem(bruno, request.requestId);
    return { request, item };
  }

  it("preserves the original tag and sharing offer across conflicting invitation retries", async () => {
    const to = "bruno@sideband.app";
    const first = await broker.owner.connect(carla, { to, share: [], tag: "work" });
    expect((await broker.owner.connect(carla, { to, share: [], tag: "work" })).requestId).toBe(first.requestId);
    expect((await broker.owner.connect(carla, { to, tag: "work" })).requestId).toBe(first.requestId);
    await expect(broker.owner.connect(carla, { to, share: ["availability"] })).rejects.toMatchObject({ code: "conflict" });
    await expect(broker.owner.connect(carla, { to, tag: "family" })).rejects.toMatchObject({ code: "conflict" });
    await broker.owner.answerInvitation(bruno, first.requestId, { accept: true, share: [] });
    expect((await broker.owner.contacts(carla)).contacts).toMatchObject([{ address: to, gives: [], tag: "work" }]);
    await broker.owner.removeContact(carla, to);
    const grant = await broker.owner.setGrant(carla, { grantee: to, category: "general" });
    await broker.owner.removeContact(carla, to);
    expect(await broker.owner.grants(carla)).toContainEqual(grant);
  });

  it("sin elección explícita el agente no acepta; el titular aún puede aceptar desde Contactos", async () => {
    const { request, item } = await invite();
    expect(request).toMatchObject({ final: false, waitingFor: "agent" });
    expect(item).toMatchObject({ from: "carla@sideband.app", tool: "connect", allowedFields: ["accepted"] });
    await expect(broker.agent.reply(bruno, { ...item, outcome: "answered", result: { accepted: true } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect((await broker.owner.contacts(bruno)).incoming).toEqual([
      expect.objectContaining({ requestId: request.requestId, address: "carla@sideband.app", offer: basicSharing }),
    ]);

    const share: Sharing = ["availability", "general"];
    await broker.owner.answerInvitation(bruno, request.requestId, { accept: true, share });
    await expectFinal(carla, request.requestId, "allow", "answered", { accepted: true });
    expect(await broker.owner.contacts(bruno)).toEqual({
      contacts: [{ address: "carla@sideband.app", gives: share, receives: basicSharing }],
      presets: { friend: contactTags.friend.sharing, family: contactTags.family.sharing, work: contactTags.work.sharing },
      incoming: [],
      outgoing: [],
    });
    expect((await broker.owner.contacts(carla)).contacts).toEqual([
      { address: "bruno@sideband.app", gives: basicSharing, receives: share },
    ]);
    expect(await broker.agent.ask(carla, availability)).toMatchObject({ final: false, waitingFor: "agent" });
    expect(await broker.agent.ask(carla, { to: "bruno@sideband.app", tool: "interest_check", args: { interest: "cerámica" } }))
      .toMatchObject({ final: true, decision: "deny" });
  });

  it("el agente acepta una invitación escalada con permiso delegado y categorías explícitas", async () => {
    const { item, request } = await invite();
    await broker.agent.reply(bruno, { ...item, outcome: "needs_owner" });
    expect(await broker.agent.inbox(bruno)).toEqual([]);
    const [pending] = await broker.agent.inbox(bruno, true);
    expect(pending?.requestId).toBe(request.requestId);
    const reply = { requestId: request.requestId, nonce: pending!.nonce, outcome: "answered" as const,
      result: { accepted: true }, share: ["health"] as Sharing };
    await expect(broker.agent.reply(bruno, reply)).rejects.toMatchObject({ code: "forbidden" });
    const agent: Principal = { ...bruno, scopes: [...bruno.scopes, "sideband:accept"] };
    await expect(broker.agent.reply({ ...carla, scopes: agent.scopes }, reply)).rejects.toMatchObject({ code: "not_found" });
    await broker.agent.reply(agent, reply);
    expect((await broker.owner.contacts(bruno)).contacts).toEqual([
      { address: "carla@sideband.app", gives: ["health"], receives: basicSharing },
    ]);
    await expectFinal(carla, request.requestId, "allow", "answered", { accepted: true });
    await expect(broker.agent.reply(agent, reply)).rejects.toMatchObject({ code: "conflict" });
  });

  it("no crea contactos ni permisos cuando el destinatario rechaza", async () => {
    const { request } = await invite();
    await broker.owner.answerInvitation(bruno, request.requestId, { accept: false });
    expect(await broker.agent.status(carla, request.requestId)).toMatchObject({ final: true, decision: "deny" });
    expect(await friends(bruno)).toEqual([]);
    expect(await friends(carla)).toEqual([]);
    expect(await broker.owner.grants(bruno)).toEqual([aliceGrant]);
    expect(await broker.owner.grants(carla)).toEqual([]);
  });

  it("deniega las invitaciones a direcciones sin destinatario", async () => {
    const request = await broker.agent.ask(carla, { ...connect, to: "nadie@sideband.app" });
    expect(request).toMatchObject({ final: true, decision: "deny" });
    expect((await broker.tick(now)).wakesOk).toBe(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it("repetir la invitación devuelve la abierta y la invitación cruzada del titular conecta a ambos", async () => {
    const offer: Sharing = ["interests"];
    const first = await broker.owner.connect(carla, "bruno@sideband.app", offer);
    expect((await broker.owner.connect(carla, "bruno@sideband.app")).requestId).toBe(first.requestId);
    expect((await broker.owner.contacts(carla)).outgoing).toEqual([
      expect.objectContaining({ requestId: first.requestId, address: "bruno@sideband.app", offer }),
    ]);
    await expect(broker.agent.ask(bruno, { ...connect, to: "carla@sideband.app" }))
      .rejects.toMatchObject({ code: "invalid_input" });

    const crossed = await broker.owner.connect(bruno, "carla@sideband.app");
    expect(crossed).toMatchObject({ final: true, result: { accepted: true } });
    await expectFinal(carla, first.requestId, "allow", "answered", { accepted: true });
    expect((await broker.owner.contacts(bruno)).contacts).toEqual([
      { address: "carla@sideband.app", gives: basicSharing, receives: offer },
    ]);
    await expect(broker.owner.connect(carla, "bruno@sideband.app")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("las etiquetas ponen lo que se comparte y el contacto editado a mano conserva lo suyo", async () => {
    const first = await broker.owner.connect(carla, "bruno@sideband.app", undefined, "work");
    expect((await broker.owner.contacts(carla)).outgoing[0]?.offer).toEqual(contactTags.work.sharing);
    await broker.owner.answerInvitation(bruno, first.requestId, { accept: true, tag: "family" });
    expect((await broker.owner.contacts(bruno)).contacts).toEqual([
      { address: "carla@sideband.app", tag: "family", gives: contactTags.family.sharing, receives: contactTags.work.sharing },
    ]);
    expect((await broker.owner.contacts(carla)).contacts[0]).toMatchObject({ tag: "work", gives: ["availability"] });
    expect((await broker.agent.contacts(carla)).contacts[0]).toMatchObject({ tag: "work" });

    await broker.owner.setTagPreset(carla, "work", ["availability", "interests"]);
    expect((await broker.owner.contacts(carla)).contacts[0]?.gives).toEqual(["availability", "interests"]);
    expect((await broker.owner.contacts(carla)).presets.work).toEqual(["availability", "interests"]);

    await broker.owner.setSharing(carla, "bruno@sideband.app", ["general"]);
    await broker.owner.setTagPreset(carla, "work", ["availability"]);
    expect((await broker.owner.contacts(carla)).contacts[0]?.gives).toEqual(["general"]);

    await broker.owner.setContactTag(carla, "bruno@sideband.app", "friend");
    expect((await broker.owner.contacts(carla)).contacts[0]).toMatchObject({ tag: "friend", gives: contactTags.friend.sharing });
    await expect(broker.owner.setContactTag(carla, "diego@sideband.app", "friend")).rejects.toMatchObject({ code: "not_found" });

    await broker.owner.removeContact(carla, "bruno@sideband.app");
    const again = await broker.owner.connect(carla, "bruno@sideband.app");
    await broker.owner.answerInvitation(bruno, again.requestId, { accept: true });
    expect((await broker.owner.contacts(carla)).contacts[0]).not.toHaveProperty("tag");
  });

  it("el agente lista los contactos y los círculos aceptados de su titular", async () => {
    const { request } = await invite();
    await broker.owner.answerInvitation(bruno, request.requestId, { accept: true, share: [] });
    const circle = await broker.owner.createCircle(alice, "Fútbol");
    await broker.owner.inviteToCircle(alice, circle.id, "carla@sideband.app");
    await broker.owner.inviteToCircle(alice, circle.id, "bruno@sideband.app");
    await broker.owner.joinCircle(carla, circle.id);

    expect(await broker.agent.contacts(carla)).toEqual({
      contacts: [{ address: "bruno@sideband.app", theyShare: [], youShare: basicSharing }],
      circles: [{ name: "Fútbol", members: ["alice@sideband.app"] }],
    });
    expect((await broker.agent.contacts(bruno)).circles).toEqual([]);
    await expect(broker.agent.contacts({ ...carla, scopes: ["sideband:inbox"] })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("cada titular cambia lo que comparte sin tocar lo del otro", async () => {
    const { request } = await invite();
    await broker.owner.answerInvitation(bruno, request.requestId, { accept: true });
    const pending = await broker.agent.ask(carla, availability);
    await broker.owner.setSharing(bruno, "carla@sideband.app", []);
    expect(await broker.agent.status(carla, pending.requestId)).toMatchObject({ final: true, decision: "deny" });
    expect((await broker.owner.contacts(carla)).contacts).toEqual([
      { address: "bruno@sideband.app", gives: basicSharing, receives: [] },
    ]);
    await expect(broker.owner.setSharing(bruno, "diego@sideband.app", basicSharing)).rejects.toMatchObject({ code: "not_found" });
  });

  it("dejar de ser contactos borra la conexión y los permisos en ambos sentidos", async () => {
    const { request } = await invite();
    await broker.owner.answerInvitation(bruno, request.requestId, { accept: true });
    const pending = await broker.agent.ask(carla, availability);

    await broker.owner.removeContact(bruno, "carla@sideband.app");
    expect(await friends(bruno)).toEqual([]);
    expect(await friends(carla)).toEqual([]);
    expect(await broker.owner.grants(bruno)).toEqual([aliceGrant]);
    expect(await broker.owner.grants(carla)).toEqual([]);
    expect(await broker.agent.status(carla, pending.requestId)).toMatchObject({ final: true, decision: "deny" });
  });

  it("permite que el titular acepte con decide cuando el agente escala", async () => {
    const { request, item } = await invite();
    await broker.agent.reply(bruno, { requestId: item.requestId, nonce: item.nonce, outcome: "needs_owner" });
    await broker.owner.decide(bruno, request.requestId, { kind: "answer", result: { accepted: true } });
    expect(await friends(bruno)).toEqual(["carla@sideband.app"]);
    expect(await friends(carla)).toEqual(["bruno@sideband.app"]);
  });

  it("rechaza conectar consigo mismo", async () => {
    await expect(broker.owner.connect(carla, "carla@sideband.app")).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("grants", () => {
  const toCarla: GrantInput = { grantee: "carla@sideband.app", category: "availability" };

  it("permite las tools de la categoría del grant y deniega al revocarlo", async () => {
    const ask = () => broker.agent.ask(carla, availability);
    expect(await ask()).toMatchObject({ final: true, decision: "deny" });

    const grant = await broker.owner.setGrant(bruno, toCarla);
    expect(await broker.agent.capabilities(carla, availability.to))
      .toMatchObject({ tools: [
        { tool: "availability", allowedFields: ["available", "freeSlots"] },
        { tool: "question", categories: ["availability"] },
        { tool: "connect", allowedFields: ["accepted"] },
      ] });
    const answered = await ask();
    const item = await inboxItem(bruno, answered.requestId);
    const result = { available: true, freeSlots: ["10:00-10:30"] };
    await broker.agent.reply(bruno, { ...item, outcome: "answered", result });
    expect(await broker.agent.status(carla, answered.requestId)).toMatchObject({ result });

    const pending = await ask();
    await broker.owner.revokeGrant(bruno, grant.id);
    expect(await broker.owner.grants(bruno)).toEqual([aliceGrant]);
    expect(await broker.agent.inbox(bruno)).toEqual([]);
    for (const { requestId } of [answered, pending, await ask()]) {
      expect(await broker.agent.status(carla, requestId)).toMatchObject({ final: true, decision: "deny" });
    }
  });

  it("conserva un grant por destinatario y categoría, y solo su titular lo revoca", async () => {
    const grant = await broker.owner.setGrant(bruno, toCarla);
    expect(await broker.owner.setGrant(bruno, toCarla)).toEqual(grant);
    const interests = await broker.owner.setGrant(bruno, { ...toCarla, category: "interests" });
    expect(await broker.owner.grants(bruno)).toEqual([aliceGrant, grant, interests]);

    await expect(broker.owner.revokeGrant(alice, grant.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.setGrant(bruno, { ...toCarla, grantee: availability.to }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(broker.owner.setGrant(bruno, { ...toCarla, category: "unknown" } as unknown as GrantInput))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("círculos", () => {
  const ask = () => broker.agent.ask(carla, availability);
  const [aliceAddress, brunoAddress, carlaAddress] = ["alice@sideband.app", "bruno@sideband.app", "carla@sideband.app"];

  async function circleOf(...members: Principal[]) {
    const circle = await broker.owner.createCircle(alice, "Fútbol");
    for (const member of members) {
      await broker.owner.inviteToCircle(alice, circle.id, `${member.userId}@sideband.app`);
      await broker.owner.joinCircle(member, circle.id);
    }
    return circle;
  }

  it("da la política base entre miembros solo después de aceptar la invitación", async () => {
    const circle = await broker.owner.createCircle(alice, "  Fútbol  ");
    expect(circle).toEqual({
      id: expect.any(String), name: "Fútbol", owner: aliceAddress, members: [{ address: aliceAddress, joined: true }],
    });
    await broker.owner.inviteToCircle(alice, circle.id, brunoAddress);
    await broker.owner.inviteToCircle(alice, circle.id, carlaAddress);
    await broker.owner.joinCircle(bruno, circle.id);
    expect(await ask()).toMatchObject({ final: true, decision: "deny" });
    expect(await broker.owner.circles(carla)).toMatchObject([{ id: circle.id, members: [
      { address: aliceAddress, joined: true }, { address: brunoAddress, joined: true }, { address: carlaAddress, joined: false },
    ] }]);

    await broker.owner.joinCircle(carla, circle.id);
    await broker.owner.joinCircle(carla, circle.id);
    expect((await broker.agent.capabilities(carla, brunoAddress)).tools).toMatchObject([
      { tool: "availability", allowedFields: ["available", "freeSlots"] },
      { tool: "question", categories: ["availability", "interests"] },
      { tool: "interest_check", allowedFields: ["matches"] },
      { tool: "connect" },
    ]);
    const pending = await ask();
    expect(await inboxItem(bruno, pending.requestId)).toMatchObject({ allowedFields: ["available", "freeSlots"] });
    expect(await broker.agent.ask(carla, { to: brunoAddress, tool: "question", args: { text: "¿Dónde vives?", category: "general" } }))
      .toMatchObject({ final: true, decision: "deny" });
  });

  it("salir o ser sacado cierra lo pendiente y corta el acceso en ambos sentidos", async () => {
    const circle = await circleOf(bruno, carla);
    const toBruno = await ask();
    const toCarla = await broker.agent.ask(bruno, { ...availability, to: carlaAddress });

    await broker.owner.removeFromCircle(carla, circle.id, carlaAddress);
    expect(await broker.agent.status(carla, toBruno.requestId)).toMatchObject({ final: true, decision: "deny" });
    expect(await broker.agent.status(bruno, toCarla.requestId)).toMatchObject({ final: true, decision: "deny" });
    expect(await ask()).toMatchObject({ final: true, decision: "deny" });
    expect(await broker.owner.circles(carla)).toEqual([]);

    await broker.owner.removeFromCircle(alice, circle.id, brunoAddress);
    await broker.owner.removeFromCircle(alice, circle.id, brunoAddress);
    expect((await broker.owner.circles(alice))[0]?.members).toEqual([{ address: aliceAddress, joined: true }]);
  });

  it("conserva el acceso del círculo al quitar un contacto y revoca sus permisos directos", async () => {
    await circleOf(bruno, carla);
    const invitation = await broker.owner.connect(carla, brunoAddress);
    await broker.owner.answerInvitation(bruno, invitation.requestId, {
      accept: true, share: ["general"],
    });

    const circleRequest = await ask();
    const directRequest = await broker.agent.ask(carla, {
      to: brunoAddress, tool: "question", args: { text: "¿Puedes ayudar?", category: "general" },
    });
    expect(directRequest).toMatchObject({ final: false, waitingFor: "agent" });

    await broker.owner.removeContact(bruno, carlaAddress);
    expect((await broker.owner.contacts(bruno)).contacts).toEqual([]);
    expect(await inboxItem(bruno, circleRequest.requestId)).toMatchObject({ allowedFields: ["available", "freeSlots"] });
    expect(await broker.agent.status(carla, directRequest.requestId)).toMatchObject({ final: true, decision: "deny" });
  });

  it("mantiene el acceso mientras ambos sigan en otro círculo o exista un grant", async () => {
    const [futbol, trabajo] = [await circleOf(bruno, carla), await circleOf(bruno, carla)];
    await broker.owner.removeFromCircle(carla, futbol.id, carlaAddress);
    expect(await ask()).toMatchObject({ final: false, waitingFor: "agent" });

    await broker.owner.setGrant(bruno, { grantee: carlaAddress, category: "availability" });
    await broker.owner.deleteCircle(alice, trabajo.id);
    expect(await ask()).toMatchObject({ final: false, waitingFor: "agent" });
  });

  it("solo quien lo creó invita, saca a otros y lo elimina", async () => {
    const circle = await circleOf(bruno);
    await expect(broker.owner.inviteToCircle(bruno, circle.id, carlaAddress)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.removeFromCircle(bruno, circle.id, aliceAddress)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.deleteCircle(bruno, circle.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.joinCircle(carla, circle.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.removeFromCircle(carla, circle.id, carlaAddress)).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.owner.removeFromCircle(alice, circle.id, aliceAddress)).rejects.toMatchObject({ code: "conflict" });
    await expect(broker.owner.createCircle(alice, " ")).rejects.toMatchObject({ code: "invalid_input" });
    expect(await broker.owner.circles(bruno)).toHaveLength(1);
  });
});

describe("avisos al canal de origen", () => {
  const channelHook: WakeTarget = { kind: "standard_webhook", url: "https://example.com/whatsapp", secret: "whsec_canal" };
  const question: AskInput = { to: "bruno@sideband.app", tool: "question", args: { text: "¿Puedes el sábado?", category: "availability" } };

  // Notices the worker sent to Alice's channel, in order.
  function channelNotices() {
    return wake.mock.calls.filter(([target]) => JSON.stringify(target) === JSON.stringify(channelHook)).map(([, notice]) => notice);
  }

  beforeEach(async () => {
    await broker.owner.setChannel(alice, "whatsapp", channelHook);
  });

  it("avisa una sola vez al canal cuando el agente del destinatario responde", async () => {
    const view = await broker.owner.ask(alice, question, "whatsapp");
    await broker.tick(now);
    expect(channelNotices()).toEqual([]);

    await broker.agent.reply(bruno, { ...await inboxItem(bruno, view.requestId), outcome: "answered", result: { answer: "Sí, a las 10." } });
    await broker.tick(now);
    await broker.tick(now);
    expect(channelNotices()).toEqual([{ requestId: view.requestId, event: "sideband.request.updated" }]);
  });

  it("avisa cuando la solicitud espera al titular del destinatario y otra vez cuando él responde", async () => {
    const view = await broker.owner.ask(alice, question, "whatsapp");
    await broker.agent.reply(bruno, { ...await inboxItem(bruno, view.requestId), outcome: "needs_owner" });
    await broker.tick(now);
    await broker.owner.decide(bruno, view.requestId, { kind: "answer", result: { answer: "Sí" } });
    await broker.tick(now);
    const updated = { requestId: view.requestId, event: "sideband.request.updated" };
    expect(channelNotices()).toEqual([updated, updated]);
  });

  it("no avisa lo que se decidió al crear la solicitud ni lo que no vino de un canal", async () => {
    const denied = await broker.owner.ask(carla, { ...question, to: "alice@sideband.app" }, "whatsapp");
    expect(denied).toMatchObject({ final: true, decision: "deny" });
    await broker.owner.setChannel(carla, "whatsapp", channelHook);
    const plain = await broker.owner.ask(alice, question);
    await broker.agent.reply(bruno, { ...await inboxItem(bruno, plain.requestId), outcome: "answered", result: { answer: "Sí" } });
    await broker.tick(now);
    expect(channelNotices()).toEqual([]);
  });

  it("reintenta un aviso fallido sin cambiar el resultado de la solicitud", async () => {
    const view = await broker.owner.ask(alice, question, "whatsapp");
    await broker.agent.reply(bruno, { ...await inboxItem(bruno, view.requestId), outcome: "answered", result: { answer: "Sí" } });
    wake.mockResolvedValue({ ok: false, retryable: true, ms: 1 });
    // One attempt plus one retry per configured delay after the first.
    for (const delay of [0, 10_000, 30_000, 60_000]) {
      advance(delay);
      await broker.tick(now);
    }
    expect(channelNotices()).toHaveLength(3);
    await expectFinal(alice, view.requestId, "allow", "answered", { answer: "Sí" });
  });

  it.each(["recovered", "attempted", "threw"] as const)("reports one exhausted origin notice (%s)", async (mode) => {
    const sink = memorySink();
    const telemetry = createTelemetry({ service: "worker", sink, lifecycle: false });
    // An insecure callback is rejected locally by the real adapter.
    await broker.owner.setChannel(alice, "whatsapp", { ...channelHook, url: "http://127.0.0.1/notice" });
    const view = await broker.owner.ask(alice, question, "whatsapp");
    await broker.tick(now);
    await broker.agent.reply(bruno, { ...await inboxItem(bruno, view.requestId), outcome: "answered", result: { answer: "Sí" } });
    const waker = mode === "attempted" ? createWaker({ allowInsecure: false, telemetry }) : deps.waker;
    broker = createBroker({ ...deps, waker, telemetry, config: { ...deps.config, wakeRetryDelaysMs: [0] } });
    if (mode === "recovered") {
      const lease = new Date(now.getTime() + 60_000);
      const jobs = await deps.store.tx((tx) => tx.claimDueWakes(now, lease, 1));
      expect(jobs).toMatchObject([{ audience: "origin", attempt: 1 }]);
      advance(60_000);
    }
    if (mode === "threw") wake.mockRejectedValueOnce(new Error("adapter unavailable"));
    await broker.tick(now);
    expect(sink.find("wake.exhausted")).toMatchObject([{ requestId: view.requestId, attrs: { attempts: 1 } }]);
  });

  it("rechaza un canal o un aviso inválido", async () => {
    await expect(broker.owner.setChannel(alice, "sms" as "whatsapp", channelHook)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(broker.owner.setChannel(alice, "whatsapp", { kind: "standard_webhook" } as WakeTarget))
      .rejects.toMatchObject({ code: "invalid_input" });
  });
});
