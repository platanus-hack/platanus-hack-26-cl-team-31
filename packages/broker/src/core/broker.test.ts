import { generateKeyPairSync } from "node:crypto";
import {
  ActivityItem,
  InboxItem,
  RequesterView,
  SharingRules,
  WAKE_EVENT,
  type AskInput,
  type Principal,
  type WakeTarget,
  type Waker,
} from "@team-31/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBroker, createMemoryStore, type BrokerCore, type BrokerDeps } from "../index.js";
import { createOwnerRuntime, localReadTool } from "../client/runtime.js";
import { deriveNonce, verifyJson } from "./crypto.js";

const principals: Record<"alice" | "bruno" | "carla", Principal> = {
  alice: { userId: "alice", agentId: "alice-bot", scopes: ["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"] },
  bruno: { userId: "bruno", agentId: "bruno-bot", scopes: ["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"] },
  carla: { userId: "carla", agentId: "carla-bot", scopes: ["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"] },
};
const { alice, bruno, carla } = principals;
const availability: AskInput = {
  to: "bruno@nexo.app", tool: "availability", purpose: "Coordinar", args: {
    date: "2026-11-26", start: "09:00", durationMinutes: 30, timezone: "America/Santiago",
  },
};
const webhook: WakeTarget = { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_demo" };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const nonceKey = new Uint8Array(32).fill(4);
const defaultRules = SharingRules.parse({
  publicProfile: { displayName: "Bruno", headline: "Ingeniero" },
  circles: { amigos: ["alice@nexo.app"] },
  grants: { amigos: [{ tool: "availability", fields: ["available"], guidance: "Solo libre u ocupado" }] },
});

let now: Date;
let broker: BrokerCore;
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
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 10_000, 30_000], addressDomain: "nexo.app" },
  };
  broker = createBroker(deps);
  for (const p of Object.values(principals)) {
    await broker.owner.claimAddress(p, p.userId);
  }
  await broker.owner.setRules(bruno, defaultRules);
});

function advance(ms: number): void {
  now = new Date(now.getTime() + ms);
}

async function askAvailability() {
  return broker.agent.ask(alice, availability);
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
  it("responde el perfil público al instante con sobre y respuesta firmados", async () => {
    const view = await broker.agent.ask(alice, { to: availability.to, tool: "profile", args: {} });
    expect(view).toMatchObject({ final: true, decision: "allow", result: defaultRules.publicProfile });
    expect(await expectFinal(alice, view.requestId, "allow", "answered", defaultRules.publicProfile)).toEqual(view);
    const row = await deps.store.tx((tx) => tx.getRequest(view.requestId));
    expect(row).toBeTruthy();
    expect(await verifyJson(publicKey, {
      id: view.requestId, from: "alice@nexo.app", to: availability.to, tool: "profile",
      args: {}, createdAt: now.toISOString(), expiresAt: view.expiresAt,
    }, row!.envelopeSignature)).toBe(true);
    expect(await broker.agent.inbox(bruno)).toEqual([]);
    expect((await broker.tick(now)).wakesOk).toBe(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it("valida nonce y esquema, filtra el resultado y admite una sola respuesta", async () => {
    const pending = await askAvailability();
    expect(pending).toMatchObject({ final: false, waitingFor: "agent" });
    const item = await inboxItem(bruno, pending.requestId);
    expect(item).toMatchObject({
      requestId: pending.requestId, allowedFields: ["available"],
      ownerAuthorization: { guidance: "Solo libre u ocupado", verifiedBy: "broker" },
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
      status: "answered", deliveredFields: ["available"], droppedFields: ["freeSlots", "privateNote"],
    });
    await expect(broker.agent.reply(bruno, reply)).rejects.toMatchObject({ code: "conflict" });
    const view = await expectFinal(alice, item.requestId, "allow", "answered", { available: true });
    expect(view).toMatchObject({ result: { available: true } });
    expect(JSON.stringify(view)).not.toContain("privateNote");
    const sent = ActivityItem.parse((await broker.owner.activity(alice))[0]);
    expect(sent).toMatchObject({ direction: "sent", droppedFields: ["freeSlots"] });
    expect(sent).not.toHaveProperty("decisionReason");
    const events = await deps.store.tx((tx) => tx.listEvents([item.requestId]));
    expect(events.filter((event) => event.code).map((event) => event.code)).toEqual(["forbidden", "invalid_input", "conflict"]);
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

  it("deja una solicitud sin regla en espera y permite una respuesta manual del dueño", async () => {
    const pending = await broker.agent.ask(carla, {
      to: availability.to, tool: "question", args: { text: "¿Disponible?" }, purpose: "Coordinar",
    });
    expect(pending).toMatchObject({ final: false, waitingFor: "owner" });
    expect(await broker.owner.pending(bruno)).toMatchObject([{
      requestId: pending.requestId, escalated: false, senderMessage: { text: "¿Disponible?", purpose: "Coordinar", trusted: false },
    }]);
    await expect(broker.owner.decide(bruno, pending.requestId, { kind: "answer", result: { available: true } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await broker.owner.decide(bruno, pending.requestId, { kind: "answer", result: { answer: "Sí" } });
    expect(await expectFinal(carla, pending.requestId, "allow", "answered", { answer: "Sí" })).toMatchObject({ result: { answer: "Sí" } });
  });

  it("devuelve denegaciones firmadas sin motivos para bloqueados y direcciones desconocidas", async () => {
    await broker.owner.setRules(bruno, { ...defaultRules, blocked: ["alice@nexo.app"] });
    for (const to of ["bruno@nexo.app", "unknown@nexo.app"]) {
      const denied = await broker.agent.ask(alice, { to, tool: "profile", args: {} });
      expect(denied).toEqual({
        requestId: expect.any(String), to, tool: "profile", expiresAt: expect.any(String),
        final: true, decision: "deny", signature: expect.any(String),
      });
      await expectFinal(alice, denied.requestId, "deny", "deny");
    }
    expect(await broker.owner.activity(alice)).not.toEqual(expect.arrayContaining([expect.objectContaining({ decisionReason: expect.anything() })]));
    await expect(broker.agent.ask(alice, { ...availability, to: "alice@nexo.app" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("aislamiento y concurrencia", () => {
  it("aísla 80 solicitudes concurrentes entre tres usuarios", async () => {
    for (const p of Object.values(principals)) {
      await broker.owner.setRules(p, SharingRules.parse({
        circles: { todos: ["alice@nexo.app", "bruno@nexo.app", "carla@nexo.app"] },
        grants: { todos: [{ tool: "question", fields: ["answer"] }] },
      }));
    }
    const users = [alice, bruno, carla] as const;
    const rows = await Promise.all(Array.from({ length: 80 }, async (_, number) => {
      const from = users[number % users.length]!;
      const to = users[(number + 1) % users.length]!;
      const text = `Solicitud ${number}`;
      const view = await broker.agent.ask(from, { to: `${to.userId}@nexo.app`, tool: "question", args: { text } });
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
  it("vence solicitudes de agente y dueño en el plazo exacto", async () => {
    const agent = await askAvailability();
    const owner = await broker.agent.ask(carla, { ...availability });
    advance(900_000);
    expect(await broker.tick(now)).toEqual({ expired: 2, wakesOk: 0, wakesRetried: 0, wakesFailed: 0 });
    await expectFinal(alice, agent.requestId, "unanswered", "expired");
    await expectFinal(carla, owner.requestId, "unanswered", "expired");
    expect(wake).not.toHaveBeenCalled();
  });

  it("conserva el cierre firmado cuando una respuesta o aprobación llega vencida", async () => {
    const agent = await askAvailability();
    const item = await inboxItem(bruno, agent.requestId);
    const owner = await broker.agent.ask(carla, availability);
    advance(900_000);
    await expect(broker.agent.reply(bruno, { ...item, outcome: "no_data" })).rejects.toMatchObject({ code: "expired" });
    await expect(broker.owner.decide(bruno, owner.requestId, { kind: "approve_once" })).rejects.toMatchObject({ code: "expired" });
    await expectFinal(alice, agent.requestId, "unanswered", "expired");
    await expectFinal(carla, owner.requestId, "unanswered", "expired");
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
    expect(wake.mock.calls).toEqual(Array.from({ length: 3 }, () => [webhook, { requestId: view.requestId, event: WAKE_EVENT }]));
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
    expect(wake).toHaveBeenCalledExactlyOnceWith(webhook, { requestId: view.requestId, event: WAKE_EVENT });
  });
});

describe("conexiones y prueba de aviso", () => {
  it("registra perezosamente, conserva revocación y verifica solo el agente seleccionado", async () => {
    const another = { ...bruno, agentId: "other-bot" };
    await Promise.all([broker.agent.inbox(bruno), broker.agent.inbox(another)]);
    expect(await broker.owner.agents(bruno)).toHaveLength(2);
    await broker.owner.setWake(bruno, bruno.agentId, webhook);
    const ping = await broker.owner.ping(bruno, bruno.agentId);
    expect(await broker.agent.inbox(another)).toEqual([]);
    const item = await inboxItem(bruno, ping.requestId);
    expect(item).toMatchObject({ from: "system@nexo.app", tool: "question", senderMessage: { trusted: false } });
    await expect(broker.agent.reply(another, { ...item, nonce: deriveNonce(nonceKey, ping.requestId), outcome: "no_data" }))
      .rejects.toMatchObject({ code: "not_found" });
    await broker.tick(now);
    expect(wake).toHaveBeenCalledExactlyOnceWith(webhook, { requestId: ping.requestId, event: WAKE_EVENT });
    await broker.agent.reply(bruno, { ...item, outcome: "no_data" });
    const agents = await broker.owner.agents(bruno);
    expect(agents.find(({ agentId }) => agentId === bruno.agentId)).toMatchObject({ verifiedAt: now.toISOString(), wakeKind: "standard_webhook" });
    expect(agents.find(({ agentId }) => agentId === another.agentId)?.verifiedAt).toBeUndefined();
    await expect(broker.owner.setWake(carla, bruno.agentId, { kind: "none" })).rejects.toMatchObject({ code: "not_found" });

    const pending = await askAvailability();
    const pendingItem = await inboxItem(bruno, pending.requestId);
    await broker.owner.revokeAgent(bruno, bruno.agentId);
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
    verifyCallback.mockResolvedValueOnce({ ok: false, reason: "challenge_failed" });
    await expect(broker.agent.connectWake(bruno, target)).rejects.toMatchObject({ code: "invalid_input", message: "challenge_failed" });
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ wakeKind: "none" });
    const connected = await broker.agent.connectWake(bruno, target);
    expect(verifyCallback).toHaveBeenLastCalledWith(target);
    expect(connected).toMatchObject({ wakeKind: "mcp_events" });
    expect(JSON.stringify(connected)).not.toContain(target.secret);
    await expect(broker.agent.disconnectWake(carla, target.subscriptionId)).rejects.toMatchObject({ code: "not_found" });
    await broker.agent.disconnectWake(bruno, target.subscriptionId);
    expect((await broker.owner.agents(bruno))[0]).toMatchObject({ wakeKind: "none" });
  });
});


describe("ejecución en el runtime del titular", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  const notice = (requestId: string) => ({ event: WAKE_EVENT, requestId });
  const revoke = () => broker.owner.setRules(bruno, { ...defaultRules, blocked: ["alice@nexo.app"] });

  it("un permiso de intereses no autoriza una pregunta sobre el domicilio ni despierta al titular", async () => {
    await broker.owner.setRules(bruno, SharingRules.parse({
      circles: {}, grants: {}, defaultForUnknown: "deny",
      people: { "alice@nexo.app": [{ tool: "interest_check", fields: ["matches"] }] },
    }));
    await broker.agent.connectWake(bruno, webhook);
    const { tools } = await broker.agent.capabilities(alice, availability.to);
    expect(tools.map(({ tool }) => tool)).toEqual(["interest_check"]);
    const view = await broker.agent.ask(alice, {
      to: availability.to, tool: "question", args: { text: "¿Cuál es el domicilio de Bruno?" },
    });
    expect(view).toEqual(await expectFinal(alice, view.requestId, "deny", "deny"));
    expect(view).not.toHaveProperty("result");
    await broker.tick(now);
    expect(wake).not.toHaveBeenCalled();
    expect(await broker.agent.inbox(bruno)).toEqual([]);
  });

  it("descubre las dos fuentes y ofrece sólo las capacidades autorizadas al solicitante", async () => {
    const { tools } = await broker.agent.capabilities(alice, availability.to);
    expect(tools).toMatchObject([
      { tool: "profile", execution: "stored", inputSchema: { type: "object" } },
      { tool: "availability", execution: "owner_runtime", allowedFields: ["available"] },
    ]);
    await revoke();
    expect(await broker.agent.capabilities(alice, availability.to)).toEqual({ tools: [] });
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

  it("filtra la salida antes de enviarla al broker y procesa un aviso repetido una sola vez", async () => {
    const request = await askAvailability();
    const reply = vi.fn(broker.agent.reply);
    const read = vi.fn(async () => ({ available: true, freeSlots: ["13:00-14:00"] }));
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
