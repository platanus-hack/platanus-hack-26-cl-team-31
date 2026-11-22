import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { verifyServiceToken } from "@team-31/auth/service";
import { BrokerError, createAgentClient, type AgentPort } from "@team-31/broker-client";
import { createMessageFlow, type InterpretMessage } from "@team-31/message-flow";
import { LIFECYCLE_EVENT, Scope, WAKE_EVENT } from "@team-31/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { HandleMessage } from "./tools/message.js";
import { createHttpServer } from "./http.js";
import { createServiceTokenMinter } from "./service-token.js";

const servers: Server[] = [];
const clients: Client[] = [];

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto HTTP de prueba.");
  return `http://127.0.0.1:${address.port}`;
}

function testPort(): AgentPort {
  return {
    connect: vi.fn(),
    searchPublicProfiles: vi.fn(), capabilities: vi.fn(),
    vaultCatalog: vi.fn(), vaultMembers: vi.fn(), changeVault: vi.fn(), queryVault: vi.fn(),
    uploadVaultDocument: vi.fn(), downloadVaultDocument: vi.fn(),
    networkUsers: vi.fn(), tags: vi.fn(), changeTag: vi.fn(), inviteToCircle: vi.fn(),
    ask: vi.fn(),
    inbox: vi.fn(),
    reply: vi.fn(),
    status: vi.fn(),
    pending: vi.fn(),
    activity: vi.fn(),
    contacts: vi.fn(),
    connectWake: vi.fn(),
    disconnectWake: vi.fn(),
  };
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "sideband-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

const audience = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test/api/auth";
const options = { audience, issuer, jwksUrl: `${issuer}/jwks`, devAuth: true };
const metadataPath = "/.well-known/oauth-protected-resource";

it("exige autenticación en cada POST y publica ambos documentos de descubrimiento", async () => {
  const origin = await listen(createHttpServer(options, testPort()));
  // The SDK v1 client strips extension fields from its parsed capabilities.
  const initialize = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: "Bearer dev:user:agent",
      Origin: new URL(audience).origin,
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }),
  });
  expect(initialize.headers.get("cache-control")).toBe("no-store");
  expect(await initialize.json()).toMatchObject({ result: { capabilities: { events: {} } } });

  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json,text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("www-authenticate")).toContain(
    `resource_metadata="https://mcp.example.test${metadataPath}/mcp"`,
  );

  for (const path of [metadataPath, `${metadataPath}/mcp`]) {
    expect(await fetch(origin + path).then((res) => res.json())).toMatchObject({
      resource: audience,
      authorization_servers: [issuer],
      scopes_supported: [...Scope.options, "offline_access"],
    });
  }
  expect(await fetch(`${origin}/healthz`).then((res) => res.json())).toEqual({ ok: true });
  for (const method of ["GET", "DELETE"]) {
    const result = await fetch(`${origin}/mcp`, { method });
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("POST");
  }
});

it("rechaza orígenes ajenos y opacos antes de conectar el agente", async () => {
  const agent = testPort();
  const origin = await listen(createHttpServer(options, agent));
  for (const browserOrigin of ["https://other.example.test", "null"]) {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST", headers: { Origin: browserOrigin, Authorization: "Bearer dev:user:agent" },
    });
    expect(response.status).toBe(403);
  }
  expect(agent.connect).not.toHaveBeenCalled();
});

it("rechaza el inicio del cliente cuando el titular tiene otro agente activo", async () => {
  const agent = testPort();
  vi.mocked(agent.connect).mockRejectedValue(new BrokerError("conflict", "Ya tienes un agente conectado."));
  const origin = await listen(createHttpServer(options, agent));
  await expect(connect(`${origin}/mcp`, "dev:ana:otro")).rejects.toThrow(/Ya tienes un agente conectado/);
  expect(agent.connect).toHaveBeenCalledWith(expect.objectContaining({ userId: "ana", agentId: "otro" }));
});

it("ejecuta ask → inbox → reply → check por HTTP y propaga la identidad de cada conexión al broker", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const getServiceToken = createServiceTokenMinter(JSON.stringify(privateKey.export({ format: "jwk" })));
  const publicKeys = { mcp: publicKey.export({ format: "jwk" }) };
  const request = {
    requestId: "request-1", to: "bob@sideband.app", tool: "question", expiresAt: "2026-11-22T00:00:00Z",
  };
  const pending = { ...request, decision: "pending", final: false, waitingFor: "agent" };
  const question = { tool: "question", to: pending.to, args: { text: "¿Vienes?", category: "general" } };
  const inbox = {
    requestId: pending.requestId, nonce: "nonce-1", from: "ana@sideband.app", tool: pending.tool,
    args: question.args, expiresAt: pending.expiresAt, allowedFields: ["answer"],
    ownerAuthorization: { rule: "amigos", guidance: "", verifiedBy: "broker" },
    senderMessage: { text: question.args.text, trusted: false }, howToReply: "Responde con sideband_reply.",
  };
  const answer = { requestId: inbox.requestId, nonce: inbox.nonce, outcome: "answered", result: { answer: "Sí" } };
  const receipt = { requestId: inbox.requestId, status: "answered", deliveredFields: ["answer"], droppedFields: [] };
  const final = { ...request, final: true, decision: "allow", outcome: "answered", result: answer.result, signature: "firma" };
  const tagId = "11111111-1111-4111-8111-111111111111";
  const createTag = { action: "create", name: "Instituciones" };
  const tags = { tags: [{ id: tagId, name: createTag.name, color: "slate", categories: [], members: [] }] };
  const ownCategory = { id: "health", name: "Salud", description: "Alergias y tratamientos.", visibility: "private", tags: [], entries: [{ label: "Alergia", value: "Maní" }], members: [] };
  const sharedCategory = { id: tagId, name: "Plan de salud", visibility: "private", canRead: true };
  const activity = { items: [{
    requestId: pending.requestId, from: "ana@sideband.app", to: pending.to, tool: pending.tool, status: "answered", outcome: "answered",
    createdAt: "2026-11-21T00:00:00Z", expiresAt: pending.expiresAt, events: [{ kind: "received", at: "2026-11-21T00:00:00Z" }], direction: "sent",
  }] };
  const decisions = { items: [{
    requestId: pending.requestId, from: "carla@sideband.app", tool: "vault_access", args: { categoryName: "Salud" },
    senderMessage: { text: "", trusted: false }, expiresAt: pending.expiresAt,
  }] };
  const requests: unknown[] = [];
  const replies: Record<string, unknown> = {
    "GET /v1/agent/activity?limit=5": activity,
    "GET /v1/agent/pending": decisions,
    "POST /v1/agent/ask": pending,
    "GET /v1/agent/inbox": { items: [inbox] },
    "POST /v1/agent/reply": receipt,
    "GET /v1/agent/requests/request-1": final,
    "POST /v1/agent/tags": { tagId },
    "GET /v1/agent/tags": tags,
    "GET /v1/agent/network/users": { addresses: [pending.to] },
    "GET /v1/agent/network/users?q=bob%40sideband.app": { addresses: [pending.to] },
    [`GET /v1/agent/vault/members?categoryId=${tagId}`]: { members: [pending.to] },
    "POST /v1/agent/vault/query": { categories: [sharedCategory] },
    "GET /v1/agent/vault?categoryId=health": { categories: [ownCategory] },
  };

  const broker = await listen(createServer(async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    let identity;
    try {
      identity = await verifyServiceToken(token, { expectedIss: "mcp", publicKeys });
    } catch {
      res.writeHead(401).end();
      return;
    }

    const path = `${req.method} ${req.url}`;
    if (path === "POST /v1/agent/connection") {
      res.writeHead(204).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path, ...identity, body: body ? JSON.parse(body) : undefined });
    if (!(path in replies)) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(replies[path]));
  }));
  const origin = await listen(createHttpServer(options, createAgentClient({ baseUrl: broker, getServiceToken })));
  const ana = await connect(`${origin}/mcp`, "dev:ana:ana-bot");
  const bob = await connect(`${origin}/mcp`, "dev:bob:bob-bot");

  const { tools } = await ana.listTools();
  expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
    ["sideband_ask", undefined], ["sideband_inbox", true], ["sideband_reply", undefined], ["sideband_check", true], ["sideband_pending", true], ["sideband_activity", true], ["sideband_contacts", true],
    ["search_public_profiles", true], ["sideband_network_users", true], ["sideband_circle_invite", undefined], ["sideband_tags", true], ["sideband_tag_change", undefined],
    ["sideband_vault_catalog", true], ["sideband_vault_members", true], ["sideband_vault_access", true], ["sideband_vault_change", undefined],
    ["sideband_vault_upload", undefined], ["sideband_vault_download", true], ["sideband_vault_query", true],
    ["sideband_vault_request_access", undefined],
  ]);
  expect(tools[0]?.inputSchema.required).toEqual(["to", "tool", "args"]);
  expect(tools[0]?.inputSchema).toMatchObject({
    properties: { tags: { type: "array" } },
    if: { properties: { tool: { const: "connect" } } },
    then: { required: ["tags"] },
  });
  // El agente que responde sólo sabe qué mandar en result si la forma viaja en el esquema.
  const reply = tools.find((tool) => tool.name === "sideband_reply");
  expect(reply?.inputSchema).toMatchObject({
    if: { properties: { outcome: { const: "answered" } } },
    then: { required: ["result"], properties: { result: { type: "object", minProperties: 1 } } },
  });
  expect(reply?.inputSchema.properties).toMatchObject({
    result: {
      description: expect.stringContaining("allowedFields"),
      anyOf: expect.arrayContaining([expect.objectContaining({ properties: { answer: expect.anything() } })]),
    },
    share: { description: expect.stringContaining("connect") },
  });
  // Rechazarlo no basta: el motivo tiene que decirle al agente qué forma esperaba.
  const asString = await bob.callTool({ name: "sideband_reply", arguments: { ...answer, result: JSON.stringify(answer.result) } });
  expect(asString.isError).toBe(true);
  expect(JSON.stringify(asString.content)).toContain("objeto JSON");
  for (const result of [null, {}, { note: "sin campos de respuesta" }]) {
    const invalid = await bob.callTool({ name: "sideband_reply", arguments: { ...answer, result } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain("result");
  }

  expect((await ana.callTool({ name: "sideband_ask", arguments: { to: pending.to, tool: "connect", args: {} } })).isError).toBe(true);
  expect((await ana.callTool({ name: "sideband_ask", arguments: { ...question, userId: "eva" } })).structuredContent).toEqual(pending);
  expect((await bob.callTool({ name: "sideband_inbox" })).structuredContent).toEqual({ items: [inbox] });
  expect((await bob.callTool({ name: "sideband_reply", arguments: answer })).structuredContent).toEqual(receipt);
  expect((await ana.callTool({ name: "sideband_check", arguments: { requestId: inbox.requestId } })).structuredContent)
    .toEqual(final);
  expect((await ana.callTool({ name: "sideband_tag_change", arguments: { change: createTag } })).structuredContent).toEqual({ tagId });
  expect((await ana.callTool({ name: "sideband_tags" })).structuredContent).toEqual(tags);
  expect((await ana.callTool({ name: "sideband_network_users" })).structuredContent).toEqual({ addresses: [pending.to] });
  expect((await ana.callTool({ name: "sideband_network_users", arguments: { q: pending.to } })).structuredContent)
    .toEqual({ addresses: [pending.to] });
  expect((await ana.callTool({ name: "sideband_vault_members", arguments: { categoryId: tagId } })).structuredContent).toEqual({ members: [pending.to] });
  expect((await ana.callTool({ name: "sideband_vault_access", arguments: { to: pending.to } })).structuredContent)
    .toEqual({ categories: [sharedCategory] });
  expect((await ana.callTool({ name: "sideband_vault_catalog", arguments: { categoryId: "health" } })).structuredContent)
    .toEqual({ categories: [ownCategory] });
  expect((await ana.callTool({ name: "sideband_circle_invite", arguments: { circleId: "circle-1", address: pending.to } })).structuredContent)
    .toEqual({ invited: pending.to });
  expect((await ana.callTool({ name: "sideband_activity", arguments: { limit: 5 } })).structuredContent).toEqual(activity);
  expect((await ana.callTool({ name: "sideband_pending", arguments: {} })).structuredContent).toEqual(decisions);

  expect(requests).toEqual([
    { path: "POST /v1/agent/ask", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: question },
    { path: "GET /v1/agent/inbox", userId: "bob", agentId: "bob-bot", scopes: Scope.options, body: undefined },
    { path: "POST /v1/agent/reply", userId: "bob", agentId: "bob-bot", scopes: Scope.options, body: answer },
    { path: "GET /v1/agent/requests/request-1", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "POST /v1/agent/tags", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: createTag },
    { path: "GET /v1/agent/tags", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "GET /v1/agent/network/users", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "GET /v1/agent/network/users?q=bob%40sideband.app", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: `GET /v1/agent/vault/members?categoryId=${tagId}`, userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "POST /v1/agent/vault/query", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: { to: pending.to } },
    { path: "GET /v1/agent/vault?categoryId=health", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: `PUT /v1/agent/circles/circle-1/members/${encodeURIComponent(pending.to)}`, userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "GET /v1/agent/activity?limit=5", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "GET /v1/agent/pending", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
  ]);
});

async function oauthFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwksOrigin = await listen(createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      keys: [{ ...publicKey.export({ format: "jwk" }), kid: "oauth-test", alg: "EdDSA" }],
    }));
  }));
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function token(scope: string) {
    const jwt = `${encode({ typ: "at+jwt", alg: "EdDSA", kid: "oauth-test" })}.${encode({
      iss: issuer, aud: audience, sub: "oauth-user", azp: "oauth-agent",
      scope, exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    return `${jwt}.${sign(null, Buffer.from(jwt), privateKey).toString("base64url")}`;
  }
  return { jwksUrl: `${jwksOrigin}/jwks`, token };
}

it("verifica un token OAuth con JWKS y usa sus scopes para bloquear llamadas", async () => {
  const agent = testPort();
  vi.mocked(agent.inbox).mockResolvedValue([]);
  vi.mocked(agent.status).mockRejectedValue(new BrokerError("not_found", "No se encontró la solicitud."));
  const { jwksUrl, token } = await oauthFixture();
  const messages = vi.fn<HandleMessage>(async (context, input) => {
    if (input.text === "estado") await context.ops.status("request-1");
    else await context.ops.contacts();
    return { kind: "clarification", question: "¿A quién?", continuationId: "opaque" };
  });
  const origin = await listen(createHttpServer({ audience, issuer, jwksUrl }, agent, undefined, messages));
  const client = await connect(`${origin}/mcp`, token("sideband:inbox sideband:status"));

  expect(await client.callTool({ name: "sideband_ask", arguments: { to: "bob@sideband.app", tool: "profile", args: {} } }))
    .toMatchObject({
      isError: true,
      content: [{ text: "Tu conexión no tiene permiso para esto; vuelve a autorizar en la App Sideband" }],
      structuredContent: { ok: false, error: { code: "forbidden" } },
    });
  expect(agent.ask).not.toHaveBeenCalled();
  expect((await client.callTool({ name: "sideband_inbox" })).structuredContent).toEqual({ items: [] });
  expect(agent.inbox).toHaveBeenCalledWith({
    userId: "oauth-user", agentId: "oauth-agent", scopes: ["sideband:inbox", "sideband:status"],
  }, undefined);
  expect(await client.callTool({ name: "sideband_check", arguments: { requestId: "missing" } })).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { code: "not_found", message: "No se encontró la solicitud." } },
  });

  const limited = await connect(`${origin}/mcp`, token("sideband:status"));
  const message = (text: string) => limited.callTool({ name: "sideband_message", arguments: { text, messageId: "ba915d2c-3d48-44eb-a3d4-146033dc216a" } });
  expect((await limited.listTools()).tools.map(t => t.name)).toContain("sideband_message");
  expect(await message("contactos")).toMatchObject({ isError: true, structuredContent: { error: { code: "forbidden" } } });
  expect(agent.contacts).not.toHaveBeenCalled();
  expect(await message("estado")).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } });
  expect(agent.status).toHaveBeenLastCalledWith({ userId: "oauth-user", agentId: "oauth-agent", scopes: ["sideband:status"] }, "request-1");
  expect(messages.mock.calls.at(-1)?.[0].deliveryId).toBe("ba915d2c-3d48-44eb-a3d4-146033dc216a");
  expect(messages.mock.calls.at(-1)?.[0].binding).toBe(JSON.stringify(["mcp", "oauth-agent", ["sideband:status"]]));
  await expect(limited.request({
    method: "events/subscribe",
    params: { name: WAKE_EVENT, delivery: { mode: "webhook", url: "https://callback.example.test/sideband", secret: `whsec_${Buffer.alloc(32).toString("base64")}` } },
  }, z.looseObject({}))).rejects.toMatchObject({ code: -32000, data: { code: "forbidden" } });
  await expect(limited.request({ method: "events/unsubscribe", params: { id: "sub_0123456789abcdef" } }, z.looseObject({})))
    .rejects.toMatchObject({ code: -32000, data: { code: "forbidden" } });
  expect(agent.connectWake).not.toHaveBeenCalled();
  expect(agent.disconnectWake).not.toHaveBeenCalled();
});

it("con sideband:vault permite leer la bóveda propia y exige sideband:ask para preguntar", async () => {
  const agent = testPort();
  const catalog = { categories: [{ id: "health", name: "Salud", visibility: "private" as const, tags: [] }] };
  vi.mocked(agent.vaultCatalog).mockResolvedValue(catalog);
  const to = "bob@sideband.app";
  const interpret = vi.fn<InterpretMessage>()
    .mockResolvedValueOnce({ action: "own_vault" })
    .mockResolvedValueOnce({ action: "ask", selector: { scope: "address", count: "one", person: to },
      tool: "interest_check", args: { interest: "cerámica" } });
  const { handleMessage } = createMessageFlow({
    interpret,
    store: { run: (_owner, _token, turn) => turn({ id: "turn", continuationId: "next", save: vi.fn() }) },
  });
  const { jwksUrl, token } = await oauthFixture();
  const origin = await listen(createHttpServer({ audience, issuer, jwksUrl }, agent, undefined, handleMessage));
  const client = await connect(`${origin}/mcp`, token("sideband:vault"));
  const message = (text: string) => client.callTool({ name: "sideband_message", arguments: { text } });

  expect((await message("¿Qué bóvedas tengo?")).structuredContent).toEqual({ kind: "own_vault", data: catalog });
  expect(agent.vaultCatalog).toHaveBeenCalledExactlyOnceWith({
    userId: "oauth-user", agentId: "oauth-agent", scopes: ["sideband:vault"],
  }, undefined);
  expect(await message(`¿A ${to} le interesa la cerámica?`)).toMatchObject({
    isError: true, structuredContent: { error: { code: "forbidden" } },
  });
  expect(agent.ask).not.toHaveBeenCalled();
});

it("anuncia eventos, valida suscripciones, devuelve los errores de callback y cancela por identidad", async () => {
  const agent = testPort();
  const origin = await listen(createHttpServer(options, agent));
  const client = await connect(`${origin}/mcp`, "dev:user:agent");
  const resultSchema = z.looseObject({});
  expect(await client.request({ method: "events/list" }, resultSchema)).toEqual({
    events: [{
      name: WAKE_EVENT, description: expect.any(String), delivery: ["webhook"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      payloadSchema: {
        type: "object", properties: { requestId: { type: "string" } },
        required: ["requestId"], additionalProperties: false,
      },
    }, expect.objectContaining({ name: LIFECYCLE_EVENT })],
  });

  const url = "https://callback.example.test/sideband";
  const secret = `whsec_${Buffer.alloc(64, 255).toString("base64")}`;
  const subscription = { name: WAKE_EVENT, delivery: { mode: "webhook", url, secret } };
  const subscribe = (params: Record<string, unknown>) => client.request({ method: "events/subscribe", params }, resultSchema);
  for (const invalid of [
    { ...subscription, name: "desconocido" },
    { ...subscription, arguments: { filtro: true } },
    { ...subscription, delivery: { ...subscription.delivery, mode: "bogus" } },
    { ...subscription, delivery: { ...subscription.delivery, secret: "whsec_!" } },
    { ...subscription, delivery: { ...subscription.delivery, secret: `whsec_${Buffer.alloc(20).toString("base64")}` } },
    { ...subscription, delivery: { ...subscription.delivery, secret: `bad_${Buffer.alloc(32).toString("base64")}` } },
  ]) {
    await expect(subscribe(invalid)).rejects.toMatchObject({ code: -32602 });
  }
  expect(agent.connectWake).not.toHaveBeenCalled();

  for (const reason of ["challenge_failed", "timeout", "https_required", "blocked_address"] as const) {
    vi.mocked(agent.connectWake).mockRejectedValueOnce(new BrokerError("invalid_input", "callback failed", { reason }));
    await expect(subscribe(subscription)).rejects.toMatchObject({ code: -32015, data: { reason } });
  }
  vi.mocked(agent.connectWake).mockRejectedValueOnce(new BrokerError("invalid_input", "challenge_failed"));
  await expect(subscribe(subscription)).rejects.toMatchObject({ code: -32602, data: { code: "invalid_input" } });
  const expectedId = `sub_${createHash("sha256").update(`user|agent|${url}|${WAKE_EVENT}|{}`).digest("hex").slice(0, 16)}`;
  const before = Date.now();
  const result = await subscribe(subscription);
  expect(result).toEqual({ id: expectedId, refreshBefore: expect.any(String), cursor: null, truncated: false });
  expect(Date.parse(String(result.refreshBefore))).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
  expect((await subscribe({ ...subscription, arguments: {} })).id).toBe(expectedId);
  const principal = { userId: "user", agentId: "agent", scopes: Scope.options };
  expect(agent.connectWake).toHaveBeenCalledWith(principal, {
    kind: "mcp_events", callbackUrl: url, secret, subscriptionId: expectedId, refreshBefore: result.refreshBefore,
  });

  const unsubscribe = (params: Record<string, unknown>) => client.request({ method: "events/unsubscribe", params }, resultSchema);
  expect(await unsubscribe({ name: WAKE_EVENT, delivery: { mode: "webhook", url } })).toEqual({});
  vi.mocked(agent.disconnectWake).mockRejectedValueOnce(new BrokerError("not_found", "No se encontró la suscripción."));
  expect(await unsubscribe({ id: expectedId })).toEqual({});
  expect(agent.disconnectWake).toHaveBeenCalledTimes(2);
  expect(agent.disconnectWake).toHaveBeenLastCalledWith(principal, expectedId);
  expect((await subscribe({ ...subscription, name: LIFECYCLE_EVENT })).id).not.toBe(expectedId);
  expect(agent.connectWake).toHaveBeenLastCalledWith(principal, expect.objectContaining({ lifecycle: true }));
});
