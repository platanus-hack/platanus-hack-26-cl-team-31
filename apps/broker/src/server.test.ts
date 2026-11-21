import { generateKeyPairSync } from "node:crypto";
import { mintServiceToken } from "@team-31/auth/service";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { ActivityItem, ErrorBody, Scope, type GrantInput, type Waker } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { createMemoryRateLimiter } from "./http/rate-limit.js";
import { createHttpServer } from "./http/server.js";
import { startWorker } from "./worker.js";

const mcp = generateKeyPairSync("ed25519");
const web = generateKeyPairSync("ed25519");
const signing = generateKeyPairSync("ed25519");
const publicKeys = { mcp: mcp.publicKey.export({ format: "jwk" }), web: web.publicKey.export({ format: "jwk" }) };
const question = { to: "bruno@sideband.app", tool: "question", args: { text: "¿Vienes mañana?", category: "general" } };
const grantToAlice: GrantInput = { grantee: "alice@sideband.app", category: "general" };
const mcpEvents = {
  kind: "mcp_events",
  callbackUrl: "https://example.com/events",
  secret: "whsec_test-only",
  subscriptionId: "test-subscription",
  refreshBefore: null,
};

function fixture(requestTtlSeconds = 900) {
  const waker = {
    wake: vi.fn<Waker["wake"]>().mockResolvedValue({ ok: true, ms: 1, retryable: false }),
    verifyCallback: vi.fn<Waker["verifyCallback"]>().mockResolvedValue({ ok: true }),
  } satisfies Waker;
  const broker = createBroker({
    store: createMemoryStore(), waker, clock: { now: () => new Date() },
    signingKey: signing.privateKey, nonceKey: new Uint8Array(32),
    config: { requestTtlSeconds, wakeRetryDelaysMs: [0, 0, 0], addressDomain: "sideband.app" },
  });
  return { broker, waker };
}

const owner = (sub: string) => mintServiceToken({ iss: "web", sub, privateKey: web.privateKey.export({ format: "jwk" }) });
const agent = (sub: string, azp = `${sub}-agent`) => mintServiceToken({
  iss: "mcp", sub, azp, scopes: Scope.options, privateKey: mcp.privateKey.export({ format: "jwk" }),
});

type App = ReturnType<typeof createHttpServer>;
type Route = { method: string; path: string; response: z.ZodType; status?: number };
function request(app: App, route: Route, { token, body, raw, path = route.path }: {
  token?: string; body?: unknown; raw?: string; path?: string;
} = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (payload !== undefined) headers.set("Content-Type", "application/json");
  return app.request(path, { method: route.method, body: payload, headers });
}

async function call<S extends z.ZodType>(app: App, route: Route & { response: S }, options?: Parameters<typeof request>[2]): Promise<z.output<S>> {
  const response = await request(app, route, options);
  expect(response.status, response.ok ? undefined : await response.clone().text()).toBe(route.status ?? 200);
  return route.response.parse(response.status === 204 ? undefined : await response.json());
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorBody.parse(await response.json()).error.code).toBe(code);
}

function streamEvents(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!frame.startsWith("event: activity\n")) continue;
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          const id = /^id: (.*)$/m.exec(frame)?.[1];
          expect(id).toBeTruthy();
          return { item: ActivityItem.parse(JSON.parse(data!)), id: id! };
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("El stream se cerró antes de recibir un evento.");
        buffer += chunk.value;
      }
    },
    close: () => reader.cancel(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HTTP interno del broker", () => {
  it("la bóveda impide almacenar en caché tanto datos privados como rechazos", async () => {
    const app = createHttpServer({ broker: fixture().broker, publicKeys });
    const allowed = await request(app, routes.ownerVault, { token: await owner("alice") });
    const rejected = await request(app, routes.ownerVault);
    expect([allowed.status, rejected.status]).toEqual([200, 401]);
    for (const response of [allowed, rejected]) expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("distinguishes an omitted invitation offer from an explicitly empty one over HTTP", async () => {
    const { broker } = fixture();
    const app = createHttpServer({ broker, publicKeys });
    const token = await owner("alice");
    for (const localPart of ["alice", "bruno", "carla"]) {
      await call(app, routes.ownerClaimAddress, { token: await owner(localPart), body: { localPart } });
    }
    const preset = await call(app, routes.ownerConnect, { token, body: { to: "bruno@sideband.app", tag: "work" } });
    const empty = await call(app, routes.ownerConnect, { token, body: { to: "carla@sideband.app", tag: "work", share: [] } });
    const { outgoing } = await call(app, routes.ownerContacts, { token });
    expect(outgoing).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: preset.requestId, offer: ["availability"] }),
      expect.objectContaining({ requestId: empty.requestId, offer: [] }),
    ]));
  });

  it("comparte por MCP las solicitudes del titular, sin saltarse los permisos", async () => {
    const { broker, waker } = fixture();
    const app = createHttpServer({ broker, publicKeys });
    const [alice, bruno, aliceBot, brunoBot] = await Promise.all([
      owner("alice"), owner("bruno"), agent("alice"), agent("bruno"),
    ]);
    await call(app, routes.ownerClaimAddress, { token: alice, body: { localPart: "alice" } });
    await call(app, routes.ownerClaimAddress, { token: bruno, body: { localPart: "bruno" } });
    await expectError(await request(app, routes.ownerAsk, { token: aliceBot, body: question }), 401, "unauthorized");
    const denied = await call(app, routes.ownerAsk, { token: alice, body: { ...question, userId: "bruno" } });
    expect(denied).toMatchObject({ decision: "deny", final: true, signature: expect.any(String) });
    expect(denied).not.toHaveProperty("decisionReason");
    await broker.tick(new Date());
    expect(waker.wake).not.toHaveBeenCalled();

    await call(app, routes.ownerSetGrant, { token: bruno, body: { grantee: "alice@sideband.app", category: "general" } });
    const asked = await call(app, routes.ownerAsk, { token: alice, body: question });
    expect(asked).toMatchObject({ decision: "pending", waitingFor: "agent" });
    expect((await call(app, routes.ownerActivity, { token: alice })).items).toContainEqual(expect.objectContaining({
      requestId: asked.requestId, from: "alice@sideband.app", direction: "sent",
    }));
    const ownerPath = `/v1/owner/requests/${asked.requestId}`;
    await expectError(await request(app, routes.ownerStatus, { token: bruno, path: ownerPath }), 404, "not_found");
    const { items: [item] } = await call(app, routes.agentInbox, { token: brunoBot });
    await call(app, routes.agentReply, { token: brunoBot, body: {
      requestId: item!.requestId, nonce: item!.nonce, outcome: "answered", result: { answer: "Sí" },
    } });
    const result = await call(app, routes.ownerStatus, { token: alice, path: ownerPath });
    expect(result).toMatchObject({ decision: "allow", result: { answer: "Sí" } });
    expect(await call(app, routes.agentStatus, { token: aliceBot, path: `/v1/agent/requests/${asked.requestId}` })).toEqual(result);
  });

  it("crea, lista y revoca un grant del titular", async () => {
    const app = createHttpServer({ broker: fixture().broker, publicKeys });
    const [bruno, alice] = await Promise.all([owner("bruno"), owner("alice")]);
    const grant = await call(app, routes.ownerSetGrant, { token: bruno, body: grantToAlice });
    expect(grant).toMatchObject(grantToAlice);
    expect(await call(app, routes.ownerGrants, { token: bruno })).toEqual({ items: [grant] });
    expect(await call(app, routes.ownerGrants, { token: alice })).toEqual({ items: [] });

    const path = `/v1/owner/grants/${grant.id}`;
    await expectError(await request(app, routes.ownerRevokeGrant, { token: alice, path }), 404, "not_found");
    await call(app, routes.ownerRevokeGrant, { token: bruno, path });
    expect(await call(app, routes.ownerGrants, { token: bruno })).toEqual({ items: [] });
  });

  it("permite enviar, listar y quitar una conexión desde la app", async () => {
    const app = createHttpServer({ broker: fixture().broker, publicKeys });
    const [alice, bruno, brunoBot] = await Promise.all([owner("alice"), owner("bruno"), agent("bruno")]);
    await call(app, routes.ownerClaimAddress, { token: alice, body: { localPart: "alice" } });
    await call(app, routes.ownerClaimAddress, { token: bruno, body: { localPart: "bruno" } });

    const sent = await call(app, routes.ownerConnect, { token: alice, body: { to: "bruno@sideband.app" } });
    expect(sent).toMatchObject({ final: false, waitingFor: "agent" });
    const { items: [invitation] } = await call(app, routes.agentInbox, { token: brunoBot });
    expect(invitation).toMatchObject({ requestId: sent.requestId, tool: "connect" });
    const answerPath = routes.ownerAnswerInvitation.path.replace(":id", sent.requestId);
    await call(app, routes.ownerAnswerInvitation, { token: bruno, path: answerPath, body: { accept: true } });
    const contacts = (token: string) => call(app, routes.ownerContacts, { token });
    expect((await contacts(alice)).contacts.map(({ address }) => address)).toEqual(["bruno@sideband.app"]);
    expect((await contacts(bruno)).contacts.map(({ address }) => address)).toEqual(["alice@sideband.app"]);

    const sharingPath = routes.ownerSetSharing.path.replace(":address", encodeURIComponent("bruno@sideband.app"));
    await call(app, routes.ownerSetSharing, {
      token: alice, path: sharingPath, body: ["availability", "general"],
    });
    expect((await contacts(bruno)).contacts[0]?.receives).toEqual(["availability", "general"]);

    const path = routes.ownerRemoveContact.path.replace(":address", encodeURIComponent("bruno@sideband.app"));
    await call(app, routes.ownerRemoveContact, { token: alice, path });
    expect((await contacts(alice)).contacts).toEqual([]);
    expect((await contacts(bruno)).contacts).toEqual([]);
    expect(await call(app, routes.ownerGrants, { token: alice })).toEqual({ items: [] });
  });

  it("devuelve un motivo estructurado cuando falla la verificación del callback", async () => {
    const { broker, waker } = fixture();
    waker.verifyCallback.mockResolvedValueOnce({ ok: false, reason: "timeout" });
    const app = createHttpServer({ broker, publicKeys });

    const response = await request(app, routes.agentConnectWake, {
      token: await agent("bruno"), body: mcpEvents,
    });
    expect(response.status).toBe(400);
    expect(ErrorBody.parse(await response.json())).toEqual({
      error: { code: "invalid_input", message: "timeout", reason: "timeout" },
    });
  });

  it("crea un círculo, invita, acepta y saca a un miembro", async () => {
    const { broker } = fixture();
    for (const userId of ["alice", "bruno"]) await broker.owner.claimAddress({ userId }, userId);
    const app = createHttpServer({ broker, publicKeys });
    const [alice, bruno] = await Promise.all([owner("alice"), owner("bruno")]);

    const circle = await call(app, routes.ownerCreateCircle, { token: alice, body: { name: "Fútbol" } });
    const member = `/v1/owner/circles/${circle.id}/members/bruno@sideband.app`;
    await call(app, routes.ownerInviteToCircle, { token: alice, path: member });
    await expectError(await request(app, routes.ownerInviteToCircle, { token: bruno, path: member }), 404, "not_found");
    await call(app, routes.ownerJoinCircle, { token: bruno, path: `/v1/owner/circles/${circle.id}/join` });
    expect((await call(app, routes.ownerCircles, { token: bruno })).items).toEqual([{
      ...circle, members: [{ address: "alice@sideband.app", joined: true }, { address: "bruno@sideband.app", joined: true }],
    }]);

    await call(app, routes.ownerRemoveFromCircle, { token: bruno, path: member });
    expect((await call(app, routes.ownerCircles, { token: bruno })).items).toEqual([]);
    await call(app, routes.ownerDeleteCircle, { token: alice, path: `/v1/owner/circles/${circle.id}` });
    expect((await call(app, routes.ownerCircles, { token: alice })).items).toEqual([]);
  });

  it("recorre el contrato completo con JWT de servicio y completa ask, inbox, reply y status", async () => {
    const { broker, waker } = fixture();
    const app = createHttpServer({ broker, publicKeys });
    const [alice, bruno, aliceBot, brunoBot, carlaBot] = await Promise.all([
      owner("alice"), owner("bruno"), agent("alice"), agent("bruno"), agent("carla"),
    ]);

    expect(await call(app, routes.health)).toEqual({ ok: true });
    expect(await call(app, routes.ownerMe, { token: bruno })).toEqual({ userId: "bruno" });
    await call(app, routes.ownerClaimAddress, { token: alice, body: { localPart: "alice" } });
    expect(await call(app, routes.ownerClaimAddress, { token: bruno, body: { localPart: "bruno" } }))
      .toEqual({ address: "bruno@sideband.app" });
    const denied = await call(app, routes.agentAsk, { token: aliceBot, body: question });
    expect(denied).toMatchObject({ final: true, decision: "deny" });

    await call(app, routes.ownerSetGrant, { token: bruno, body: grantToAlice });
    expect((await call(app, routes.ownerGrants, { token: bruno })).items).toMatchObject([grantToAlice]);

    const waiting = await call(app, routes.agentAsk, { token: aliceBot, body: question });
    const [escalated] = (await call(app, routes.agentInbox, { token: brunoBot })).items;
    await call(app, routes.agentReply, { token: brunoBot, body: {
      requestId: escalated!.requestId, nonce: escalated!.nonce, outcome: "needs_owner",
    } });
    expect((await call(app, routes.ownerPending, { token: bruno })).items[0]?.requestId).toBe(waiting.requestId);
    await call(app, routes.ownerDecide, {
      token: bruno, path: `/v1/owner/requests/${waiting.requestId}/decision`, body: { kind: "deny" },
    });
    const capabilityPath = `${routes.agentCapabilities.path}?to=bruno@sideband.app`;
    expect((await call(app, routes.agentCapabilities, { token: aliceBot, path: capabilityPath })).tools)
      .toContainEqual(expect.objectContaining({ tool: "question", allowedFields: ["answer"] }));
    await expectError(await request(app, routes.agentCapabilities, { token: bruno, path: capabilityPath }), 401, "unauthorized");
    expect(await call(app, routes.agentConnectWake, { token: brunoBot, body: mcpEvents }))
      .toMatchObject({ agentId: "bruno-agent", wakeKind: "mcp_events" });
    expect(waker.verifyCallback).toHaveBeenCalledWith(mcpEvents);
    expect((await call(app, routes.ownerAgents, { token: bruno })).items).toHaveLength(1);
    await expectError(await request(app, routes.ownerAgentDirectory), 401, "unauthorized");
    await expectError(await request(app, routes.ownerAgentDirectory, { token: aliceBot }), 401, "unauthorized");
    expect((await call(app, routes.ownerAgentDirectory, { token: alice })).items).toEqual([
      { agentId: "alice-agent", label: "alice-agent", address: "alice@sideband.app" },
      { agentId: "bruno-agent", label: "bruno-agent", address: "bruno@sideband.app" },
    ]);

    const asked = await call(app, routes.agentAsk, { token: aliceBot, body: { ...question, userId: "carla" } });
    expect(asked).toMatchObject({ final: false, waitingFor: "agent" });
    await broker.tick(new Date());
    expect(waker.wake).toHaveBeenCalledWith(mcpEvents, { event: "sideband.request.created", requestId: asked.requestId }, expect.objectContaining({ attempt: 1 }));
    const inbox = (await call(app, routes.agentInbox, { token: brunoBot })).items;
    expect(inbox).toHaveLength(1);
    const item = inbox[0]!;
    expect(item).toMatchObject({ requestId: asked.requestId, from: "alice@sideband.app", senderMessage: { trusted: false } });
    expect(await call(app, routes.agentReply, { token: brunoBot, body: {
      requestId: item.requestId, nonce: item.nonce, outcome: "answered", result: { answer: "Sí" },
    } })).toMatchObject({ requestId: asked.requestId, status: "answered" });
    const path = `/v1/agent/requests/${asked.requestId}`;
    expect(await call(app, routes.agentStatus, { token: aliceBot, path })).toMatchObject({
      final: true, outcome: "answered", result: { answer: "Sí" }, signature: expect.any(String),
    });
    await expectError(await request(app, routes.agentStatus, { token: carlaBot, path }), 404, "not_found");
    expect((await call(app, routes.ownerActivity, { token: bruno, path: "/v1/owner/activity?limit=1" })).items)
      .toMatchObject([{ requestId: asked.requestId, direction: "received", status: "answered" }]);

    const stream = streamEvents(await request(app, routes.ownerStream, { token: bruno }));
    try {
      for (const { requestId } of [denied, waiting, asked]) {
        expect((await stream.next()).item).toMatchObject({ requestId, direction: "received" });
      }
    } finally {
      await stream.close();
    }
    await call(app, routes.agentDisconnectWake, { token: brunoBot, path: "/v1/agent/wake/test-subscription" });
    await call(app, routes.ownerSetWake, { token: bruno, path: "/v1/owner/agents/bruno-agent/wake", body: { kind: "none" } });
    expect(await call(app, routes.ownerPing, { token: bruno, path: "/v1/owner/agents/bruno-agent/ping" }))
      .toMatchObject({ requestId: expect.any(String) });
    await call(app, routes.ownerRevokeAgent, { token: bruno, path: "/v1/owner/agents/bruno-agent" });
    expect((await call(app, routes.ownerAgents, { token: bruno })).items[0]?.revokedAt).toBeDefined();
  });

  it("separa emisores y rechaza tokens vencidos, faltantes o sin alcance", async () => {
    const app = createHttpServer({ ...fixture(), publicKeys });
    const [webToken, mcpToken] = await Promise.all([owner("alice"), agent("alice")]);
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ azp: "alice-agent", scope: "sideband:ask" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("mcp").setAudience("broker").setSubject("alice").setJti("expired")
      .setIssuedAt(timestamp - 100).setExpirationTime(timestamp - 40).sign(mcp.privateKey);
    const noScope = await mintServiceToken({ iss: "mcp", sub: "alice", azp: "alice-agent", privateKey: mcp.privateKey.export({ format: "jwk" }) });

    for (const token of [webToken, expired, undefined]) {
      const rejected = await request(app, routes.agentAsk, { token, body: question });
      expect(rejected.headers.get("cache-control")).toBe("no-store");
      await expectError(rejected, 401, "unauthorized");
    }
    await expectError(await request(app, routes.ownerMe, { token: mcpToken }), 401, "unauthorized");
    await expectError(await request(app, routes.ownerStream, { token: mcpToken }), 401, "unauthorized");
    await expectError(await request(app, routes.agentAsk, { token: noScope, body: question }), 403, "forbidden");
  });

  it("valida JSON, query y respuestas y correlaciona los 500 sin publicar datos", async () => {
    const { broker } = fixture();
    const sink = memorySink();
    const telemetry = createTelemetry({ service: "broker", sink, heartbeatMs: 0, lifecycle: false });
    const app = createHttpServer({ broker, publicKeys, telemetry });
    const [webToken, mcpToken] = await Promise.all([owner("alice"), agent("alice")]);
    await expectError(await request(app, routes.agentAsk, { token: mcpToken, raw: "{" }), 400, "invalid_input");
    await expectError(await request(app, routes.agentAsk, { token: mcpToken, body: { tool: "unknown" } }), 400, "invalid_input");
    await expectError(await request(app, routes.ownerActivity, { token: webToken, path: "/v1/owner/activity?limit=0" }), 400, "invalid_input");

    // Expected 4xx errors are not internal errors.
    expect(sink.find("error")).toEqual([]);

    const me = vi.spyOn(broker.owner, "me").mockResolvedValue({ userId: "alice", address: "private-metadata" });
    const invalid = await request(app, routes.ownerMe, { token: webToken });
    const errorId = invalid.headers.get("X-Error-Id");
    expect(errorId).toBeTruthy();
    await expectError(invalid, 500, "internal");
    expect(sink.find("error")).toEqual([expect.objectContaining({
      errorId, userId: "alice", attrs: expect.objectContaining({ operation: "GET /v1/owner/me", type: "invalid_schema" }),
    })]);
    expect(sink.find("http.request").at(-1)).toMatchObject({
      errorId, status: "error", attrs: { route: "/v1/owner/me", status: 500, bucket: "5xx" },
    });
    me.mockRejectedValue(new Error("private-metadata"));
    await expectError(await request(app, routes.ownerMe, { token: webToken }), 500, "internal");
    expect(sink.find("error")).toHaveLength(2);
    expect(JSON.stringify(sink.records)).not.toContain("private-metadata");
  });

  it("limita por usuario dentro de cada grupo y aplica Retry-After", async () => {
    let time = 0;
    const limiter = createMemoryRateLimiter(() => time);
    const app = createHttpServer({ ...fixture(), publicKeys, limiter });
    const [aliceBot, secondBot, brunoBot] = await Promise.all([agent("alice"), agent("alice", "other-bot"), agent("bruno")]);
    for (let i = 0; i < 30; i++) {
      await expectError(await request(app, routes.agentAsk, { token: aliceBot, body: {} }), 400, "invalid_input");
    }
    const blocked = await request(app, routes.agentAsk, { token: secondBot, body: {} });
    expect(blocked.headers.get("Retry-After")).toBe("60");
    await expectError(blocked, 429, "rate_limited");
    await expectError(await request(app, routes.agentAsk, { token: brunoBot, body: {} }), 400, "invalid_input");
    expect(await call(app, routes.agentInbox, { token: aliceBot })).toEqual({ items: [] });

    for (const [bucket, limit] of [["reply", 120], ["other", 300]] as const) {
      for (let i = 0; i < limit; i++) expect(await limiter.consume("unrelated-user", bucket)).toBeUndefined();
      expect(await limiter.consume("unrelated-user", bucket)).toEqual({ retryAfter: 60 });
    }
    time += 60_000;
    await expectError(await request(app, routes.agentAsk, { token: aliceBot, body: {} }), 400, "invalid_input");
  });

  it("emite cambios del dueño y reenvía snapshots con IDs estables al reconectar", async () => {
    const { broker } = fixture();
    for (const userId of ["alice", "bruno", "carla"]) await broker.owner.claimAddress({ userId }, userId);
    const app = createHttpServer({ broker, publicKeys });
    const [aliceBot, bruno, carla] = await Promise.all([agent("alice"), owner("bruno"), owner("carla")]);
    const unrelated = await call(app, routes.agentAsk, { token: aliceBot, body: { ...question, to: "carla@sideband.app" } });
    await broker.owner.setGrant({ userId: "bruno" }, grantToAlice);
    const asked = await call(app, routes.agentAsk, { token: aliceBot, body: question });
    const brunoBot = { userId: "bruno", agentId: "bruno-agent", scopes: Scope.options };
    const [item] = await broker.agent.inbox(brunoBot);
    await broker.agent.reply(brunoBot, { requestId: asked.requestId, nonce: item!.nonce, outcome: "needs_owner" });
    const brunoStream = streamEvents(await request(app, routes.ownerStream, { token: bruno }));
    const carlaStream = streamEvents(await request(app, routes.ownerStream, { token: carla }));
    let finalId: string;
    try {
      expect((await carlaStream.next()).item.requestId).toBe(unrelated.requestId);
      const pending = await brunoStream.next();
      expect(pending.item).toMatchObject({ requestId: asked.requestId, status: "awaiting_owner" });
      await broker.owner.decide({ userId: "bruno" }, asked.requestId, { kind: "deny" });
      const final = await brunoStream.next();
      expect(final.item).toMatchObject({ requestId: asked.requestId, status: "declined" });
      expect(final.id).not.toBe(pending.id);
      finalId = final.id;
    } finally {
      await Promise.all([brunoStream.close(), carlaStream.close()]);
    }
    const reconnect = streamEvents(await app.request(routes.ownerStream.path, {
      headers: { Authorization: `Bearer ${await owner("bruno")}`, "Last-Event-ID": finalId },
    }));
    try {
      expect(await reconnect.next()).toMatchObject({ id: finalId, item: { requestId: asked.requestId, status: "declined" } });
    } finally {
      await reconnect.close();
    }
  });

  it("cierra con una respuesta firmada al alcanzar un TTL de 2 segundos", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { broker } = fixture(2);
    await broker.owner.claimAddress({ userId: "alice" }, "alice");
    await broker.owner.claimAddress({ userId: "bruno" }, "bruno");
    const app = createHttpServer({ broker, publicKeys });
    const token = await agent("alice");
    await broker.owner.setGrant({ userId: "bruno" }, grantToAlice);
    const asked = await call(app, routes.agentAsk, { token, body: question });
    const stop = startWorker(broker, { error: vi.fn() });
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await call(app, routes.agentStatus, { token, path: `/v1/agent/requests/${asked.requestId}` }))
        .toMatchObject({ final: true, outcome: "expired", signature: expect.any(String) });
      expect(log).toHaveBeenCalledWith("[broker] Worker", expect.objectContaining({ expired: 1 }));
    } finally {
      await stop();
    }
  });

  it("omite intervalos mientras una pasada del worker sigue abierta", async () => {
    vi.useFakeTimers();
    const report = { expired: 0, wakesOk: 0, wakesRetried: 0, wakesFailed: 0 };
    let complete!: (value: typeof report) => void;
    const inflight = new Promise<typeof report>((resolve) => { complete = resolve; });
    const tick = vi.fn().mockReturnValueOnce(inflight).mockResolvedValue(report);
    const stop = startWorker({ tick }, { error: vi.fn() });
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(tick).toHaveBeenCalledTimes(1);
      complete(report);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      complete(report);
      await stop();
    }
  });
});
