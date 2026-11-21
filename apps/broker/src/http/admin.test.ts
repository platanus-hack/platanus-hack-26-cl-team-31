import { generateKeyPairSync } from "node:crypto";
import { mintServiceToken } from "@team-31/auth/service";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { ErrorBody, Scope, SharingRules, type Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { describe, expect, it } from "vitest";
import { createHttpServer } from "./server.js";

const mcp = generateKeyPairSync("ed25519");
const web = generateKeyPairSync("ed25519");
const admin = generateKeyPairSync("ed25519");
const intruder = generateKeyPairSync("ed25519");
const signing = generateKeyPairSync("ed25519");
const publicKeys = {
  mcp: mcp.publicKey.export({ format: "jwk" }),
  web: web.publicKey.export({ format: "jwk" }),
  admin: admin.publicKey.export({ format: "jwk" }),
};
const reason = "Atascada mientras revisábamos el aviso";
const alice: Principal = { userId: "alice", agentId: "alice-agent", scopes: Scope.options };
const bruno: Principal = { userId: "bruno", agentId: "bruno-agent", scopes: Scope.options };

const adminToken = (key = admin.privateKey) => mintServiceToken({
  iss: "admin", sub: "admin-1", email: "ops@nexo.app", privateKey: key.export({ format: "jwk" }),
});
const ownerToken = () => mintServiceToken({ iss: "web", sub: "bruno", privateKey: web.privateKey.export({ format: "jwk" }) });
const agentToken = () => mintServiceToken({
  iss: "mcp", sub: "bruno", azp: "bruno-agent", scopes: Scope.options, privateKey: mcp.privateKey.export({ format: "jwk" }),
});

async function fixture(keys: Partial<typeof publicKeys> = publicKeys) {
  const broker = createBroker({
    store: createMemoryStore(),
    waker: { wake: async () => ({ ok: true, retryable: false, ms: 1 }), verifyCallback: async () => ({ ok: true }) },
    clock: { now: () => new Date() }, signingKey: signing.privateKey, nonceKey: new Uint8Array(32),
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 0, 0], addressDomain: "nexo.app" },
  });
  await broker.owner.claimAddress(alice, "alice");
  await broker.owner.claimAddress(bruno, "bruno");
  await broker.owner.setRules(bruno, SharingRules.parse({
    circles: { amigos: ["alice@nexo.app"] }, grants: { amigos: [{ tool: "question", fields: ["answer"] }] },
  }));
  await broker.agent.connectWake(bruno, { kind: "standard_webhook", url: "https://example.com/hook", secret: "whsec_test" });
  const { requestId } = await broker.agent.ask(alice, { to: "bruno@nexo.app", tool: "question", args: { text: "¿Vienes?" } });
  return { broker, requestId, app: createHttpServer({ broker, publicKeys: keys }) };
}

type App = Awaited<ReturnType<typeof fixture>>["app"];
function post(app: App, path: string, { token, body = { reason } }: { token?: string; body?: unknown } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorBody.parse(await response.json()).error.code).toBe(code);
}

const rewakePath = (id: string) => routes.adminRewake.path.replace(":id", id);
const expirePath = (id: string) => routes.adminExpire.path.replace(":id", id);
const revokePath = "/v1/admin/agents/bruno/bruno-agent/revoke";

describe("rutas /v1/admin/* del broker", () => {
  it("ejecuta rewake, expire y revoke con un JWT admin y responde 204 sin caché", async () => {
    const { app, broker, requestId } = await fixture();
    const token = await adminToken();

    const rewoken = await post(app, rewakePath(requestId), { token });
    expect(rewoken.status, await rewoken.clone().text()).toBe(204);
    expect(rewoken.headers.get("Cache-Control")).toBe("no-store");

    expect((await post(app, expirePath(requestId), { token })).status).toBe(204);
    expect(await broker.agent.status(alice, requestId)).toMatchObject({ final: true, outcome: "expired" });

    expect((await post(app, revokePath, { token })).status).toBe(204);
    expect((await broker.owner.agents(bruno))[0]?.revokedAt).toBeDefined();
  });

  it("mapea not_found, conflict e invalid_input a su estado HTTP", async () => {
    const { app, requestId } = await fixture();
    const token = await adminToken();
    await expectError(await post(app, expirePath("missing"), { token }), 404, "not_found");
    await expectError(await post(app, expirePath(requestId), { token, body: { reason: "corto" } }), 400, "invalid_input");
    await expectError(await post(app, rewakePath(requestId), { token, body: {} }), 400, "invalid_input");
    await expectError(await post(app, "/v1/admin/agents/bruno/ghost/revoke", { token }), 404, "not_found");
    expect((await post(app, expirePath(requestId), { token })).status).toBe(204);
    await expectError(await post(app, expirePath(requestId), { token }), 409, "conflict");
    await expectError(await post(app, rewakePath(requestId), { token }), 409, "conflict");
  });

  it("rechaza tokens admin inválidos o ausentes y tokens mcp o web", async () => {
    const { app, broker, requestId } = await fixture();
    const tokens = [undefined, await adminToken(intruder.privateKey), await ownerToken(), await agentToken()];
    for (const token of tokens) {
      for (const path of [rewakePath(requestId), expirePath(requestId), revokePath]) {
        const response = await post(app, path, { token });
        await expectError(response, 401, "unauthorized");
        expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      }
    }
    expect(await broker.agent.status(alice, requestId)).toMatchObject({ final: false });
    expect((await broker.owner.agents(bruno))[0]?.revokedAt).toBeUndefined();
  });

  it("rechaza el JWT admin en /v1/agent/* y /v1/owner/*", async () => {
    const { app } = await fixture();
    const headers = { Authorization: `Bearer ${await adminToken()}` };
    for (const route of Object.values(routes)) {
      if (route.iss !== "mcp" && route.iss !== "web") continue;
      const path = route.path.replace(/:(\w+)/g, "x");
      const response = await app.request(path, { method: route.method, headers });
      await expectError(response, 401, "unauthorized");
    }
  });

  it("responde 401 si el broker no tiene configurada la clave pública admin", async () => {
    const { app, requestId } = await fixture({ mcp: publicKeys.mcp, web: publicKeys.web });
    await expectError(await post(app, expirePath(requestId), { token: await adminToken() }), 401, "unauthorized");
  });
});
