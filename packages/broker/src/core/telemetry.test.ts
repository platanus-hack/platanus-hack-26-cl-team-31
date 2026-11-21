import { generateKeyPairSync } from "node:crypto";
import type { AdminActor, Principal, WakeTarget, Waker } from "@team-31/protocol";
import { createTelemetry, memorySink, type MemorySink } from "@team-31/telemetry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBroker, createMemoryStore, type BrokerCore } from "../index.js";
import { deriveNonce } from "./crypto.js";

const scopes: Principal["scopes"] = ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"];
const alice: Principal = { userId: "alice", agentId: "alice-bot", scopes };
const bruno: Principal = { userId: "bruno", agentId: "bruno-bot", scopes };
const operator: AdminActor = { adminId: "admin-1", email: "ops@sideband.app" };
const secretText = "texto privado de la pregunta";
const webhook: WakeTarget = { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_demo" };
const nonceKey = new Uint8Array(32).fill(7);
const { privateKey } = generateKeyPairSync("ed25519");

let now: Date;
let sink: MemorySink;
let broker: BrokerCore;
const wake = vi.fn<Waker["wake"]>();

beforeEach(async () => {
  now = new Date("2026-11-21T15:00:00Z");
  sink = memorySink();
  wake.mockReset().mockResolvedValue({ ok: true, retryable: false, ms: 1 });
  broker = createBroker({
    store: createMemoryStore(),
    waker: { wake, verifyCallback: vi.fn() },
    clock: { now: () => now },
    signingKey: privateKey,
    nonceKey,
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 10, 20], addressDomain: "sideband.app" },
    telemetry: createTelemetry({ service: "broker", sink, heartbeatMs: 0, lifecycle: false }),
  });
  await broker.owner.claimAddress(alice, "alice");
  await broker.owner.claimAddress(bruno, "bruno");
  await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", tool: "question", fields: ["answer"] });
  sink.clear();
});

const ask = () => broker.agent.ask(alice, { to: "bruno@sideband.app", tool: "question", args: { text: secretText } });
const names = () => sink.records.map((record) => record.name);

describe("telemetría del core del broker", () => {
  it("registra la política y la creación con códigos, sin args", async () => {
    const view = await ask();
    expect(sink.find("broker.policy.evaluated")).toEqual([expect.objectContaining({
      requestId: view.requestId, userId: "alice", agentId: "alice-bot",
      attrs: { tool: "question", decision: "allow", rule: "grant" },
    })]);
    expect(sink.find("broker.request.created")).toEqual([expect.objectContaining({
      requestId: view.requestId, userId: "alice", agentId: "alice-bot", attrs: { tool: "question", rule: "grant" },
    })]);
    expect(JSON.stringify(sink.records)).not.toContain(secretText);
  });

  it("una denegación inmediata se registra como creada y cerrada", async () => {
    const view = await broker.agent.ask(alice, { to: "nadie@sideband.app", tool: "question", args: { text: secretText } });
    expect(sink.find("broker.policy.evaluated")[0]?.attrs).toEqual({ tool: "question", decision: "deny", rule: "no_recipient" });
    expect(sink.find("broker.request.closed")).toEqual([
      expect.objectContaining({ requestId: view.requestId, attrs: { outcome: "denied", escalated: false } }),
    ]);
  });

  it("registra rechazos de respuesta y la transición del agente", async () => {
    const view = await ask();
    const nonce = deriveNonce(nonceKey, view.requestId);
    await expect(broker.agent.reply(bruno, { requestId: view.requestId, nonce: "x".repeat(43), outcome: "no_data" }))
      .rejects.toMatchObject({ code: "forbidden" });
    await expect(broker.agent.reply(alice, { requestId: view.requestId, nonce, outcome: "no_data" }))
      .rejects.toMatchObject({ code: "not_found" });
    await broker.agent.reply(bruno, { requestId: view.requestId, nonce, outcome: "answered", result: { answer: "sí, privado" } });
    await expect(broker.agent.reply(bruno, { requestId: view.requestId, nonce, outcome: "no_data" }))
      .rejects.toMatchObject({ code: "conflict" });

    expect(sink.find("broker.reply.rejected").map((record) => record.attrs.code)).toEqual(["nonce", "not_recipient", "closed"]);
    expect(sink.find("broker.request.status_changed")).toEqual([expect.objectContaining({
      requestId: view.requestId, attrs: { from: "awaiting_agent", to: "answered", by: "agent" },
    })]);
    expect(sink.find("broker.request.closed")[0]?.attrs).toEqual({ outcome: "answered", escalated: false });
    expect(JSON.stringify(sink.records)).not.toContain("privado");
  });

  it("registra la decisión del dueño sobre una solicitud escalada", async () => {
    const view = await ask();
    const nonce = deriveNonce(nonceKey, view.requestId);
    await broker.agent.reply(bruno, { requestId: view.requestId, nonce, outcome: "needs_owner" });
    await broker.owner.decide(bruno, view.requestId, { kind: "deny" });
    expect(sink.find("broker.request.status_changed").map((record) => record.attrs)).toEqual([
      { from: "awaiting_agent", to: "awaiting_owner", by: "agent" },
      { from: "awaiting_owner", to: "declined", by: "owner" },
    ]);
    expect(sink.find("broker.owner.decided")).toEqual([
      expect.objectContaining({ requestId: view.requestId, userId: "bruno", attrs: { decision: "deny" } }),
    ]);
    expect(sink.find("broker.request.closed")[0]?.attrs).toEqual({ outcome: "declined", escalated: true });
  });

  it("el barrido y el admin cierran con su actor", async () => {
    const swept = await ask();
    const expired = await ask();
    await broker.admin.expire(operator, expired.requestId, "La solicitud quedó atascada en la demo");
    now = new Date(now.getTime() + 901_000);
    await broker.tick(now);

    const byRequest = (id: string) => sink.find("broker.request.status_changed").filter((record) => record.requestId === id);
    expect(byRequest(expired.requestId).map((record) => record.attrs.by)).toEqual(["admin"]);
    expect(byRequest(swept.requestId).map((record) => record.attrs)).toEqual([{ from: "awaiting_agent", to: "expired", by: "broker" }]);
    expect(sink.find("admin.action")).toEqual([
      expect.objectContaining({ requestId: expired.requestId, attrs: { action: "expire", target: expired.requestId } }),
    ]);
  });

  it("no emite eventos de una transacción revertida", async () => {
    const view = await ask();
    sink.clear();
    // Deciding a request that is awaiting the agent throws inside the transaction.
    await expect(broker.owner.decide(bruno, view.requestId, { kind: "deny" })).rejects.toMatchObject({ code: "conflict" });
    expect(names()).toEqual([]);
  });

  it("registra un permiso faltante con su operación", async () => {
    const askOnly: Principal = { ...alice, scopes: ["sideband:ask"] };
    await expect(broker.agent.connectWake(askOnly, webhook)).rejects.toMatchObject({ code: "forbidden" });
    expect(sink.find("auth.scope.denied")).toEqual([expect.objectContaining({
      userId: "alice", agentId: "alice-bot", attrs: { scope: "sideband:inbox", operation: "agent.connectWake" },
    })]);
  });

  it("registra permisos creados y revocados sin la dirección autorizada, y cierra lo que dejan sin permiso", async () => {
    const view = await ask();
    const [grant] = await broker.owner.grants(bruno);
    await broker.owner.revokeGrant(bruno, grant!.id);
    const created = await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", tool: "availability", fields: ["available"] });

    expect(sink.find("broker.grant.revoked")).toEqual([
      expect.objectContaining({ userId: "bruno", attrs: { grantId: grant!.id } }),
    ]);
    expect(sink.find("broker.grant.set")).toEqual([
      expect.objectContaining({ userId: "bruno", attrs: { grantId: created.id, tool: "availability", fields: 1 } }),
    ]);
    expect(sink.find("broker.request.status_changed")).toEqual([expect.objectContaining({
      requestId: view.requestId, attrs: { from: "awaiting_agent", to: "denied", by: "owner" },
    })]);
    const grantEvents = JSON.stringify([...sink.find("broker.grant.set"), ...sink.find("broker.grant.revoked")]);
    expect(grantEvents).not.toContain("alice@sideband.app");
  });

  it("una solicitud sin permiso queda denegada con su código", async () => {
    await broker.owner.claimAddress({ userId: "carla" }, "carla");
    await broker.agent.ask(alice, { to: "carla@sideband.app", tool: "question", args: { text: secretText } });
    expect(sink.find("broker.policy.evaluated").at(-1)?.attrs).toEqual({ tool: "question", decision: "deny", rule: "no_grant" });
  });
});
