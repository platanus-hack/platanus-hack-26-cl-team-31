import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { verifyServiceToken } from "@team-31/auth/service";
import { BrokerError, createAgentClient, type AgentPort } from "@team-31/broker/client";
import { Scope, WAKE_EVENT } from "@team-31/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
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
    capabilities: vi.fn(),
    vaultCatalog: vi.fn(), changeVault: vi.fn(), queryVault: vi.fn(),
    contactGroups: vi.fn(), changeContactGroup: vi.fn(),
    ask: vi.fn(),
    inbox: vi.fn(),
    reply: vi.fn(),
    status: vi.fn(),
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
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }),
  });
  expect(await initialize.json()).toMatchObject({ result: { capabilities: { events: {} } } });

  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json,text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
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
  const groupId = "11111111-1111-4111-8111-111111111111";
  const createGroup = { action: "create", name: "Instituciones" };
  const groups = { groups: [{ id: groupId, name: createGroup.name, members: [] }] };
  const requests: unknown[] = [];
  const replies: Record<string, unknown> = {
    "POST /v1/agent/ask": pending,
    "GET /v1/agent/inbox": { items: [inbox] },
    "POST /v1/agent/reply": receipt,
    "GET /v1/agent/requests/request-1": final,
    "POST /v1/agent/contact-groups": { groupId },
    "GET /v1/agent/contact-groups": groups,
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
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path, ...identity, body: body ? JSON.parse(body) : undefined });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(replies[path]));
  }));
  const origin = await listen(createHttpServer(options, createAgentClient({ baseUrl: broker, getServiceToken })));
  const ana = await connect(`${origin}/mcp`, "dev:ana:ana-bot");
  const bob = await connect(`${origin}/mcp`, "dev:bob:bob-bot");

  const { tools } = await ana.listTools();
  expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
    ["sideband_ask", undefined], ["sideband_inbox", true], ["sideband_reply", undefined], ["sideband_check", true], ["sideband_contacts", true],
    ["sideband_contact_groups", true], ["sideband_contact_group_change", undefined],
    ["sideband_vault_catalog", true], ["sideband_vault_change", undefined], ["sideband_vault_query", true],
  ]);
  expect(tools[0]?.inputSchema.required).toEqual(["to", "tool", "args"]);
  expect((await ana.callTool({ name: "sideband_ask", arguments: { ...question, userId: "eva" } })).structuredContent).toEqual(pending);
  expect((await bob.callTool({ name: "sideband_inbox" })).structuredContent).toEqual({ items: [inbox] });
  expect((await bob.callTool({ name: "sideband_reply", arguments: answer })).structuredContent).toEqual(receipt);
  expect((await ana.callTool({ name: "sideband_check", arguments: { requestId: inbox.requestId } })).structuredContent)
    .toEqual(final);
  expect((await ana.callTool({ name: "sideband_contact_group_change", arguments: { change: createGroup } })).structuredContent).toEqual({ groupId });
  expect((await ana.callTool({ name: "sideband_contact_groups" })).structuredContent).toEqual(groups);

  expect(requests).toEqual([
    { path: "POST /v1/agent/ask", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: question },
    { path: "GET /v1/agent/inbox", userId: "bob", agentId: "bob-bot", scopes: Scope.options, body: undefined },
    { path: "POST /v1/agent/reply", userId: "bob", agentId: "bob-bot", scopes: Scope.options, body: answer },
    { path: "GET /v1/agent/requests/request-1", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
    { path: "POST /v1/agent/contact-groups", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: createGroup },
    { path: "GET /v1/agent/contact-groups", userId: "ana", agentId: "ana-bot", scopes: Scope.options, body: undefined },
  ]);
});

it("verifica un token OAuth con JWKS y usa sus scopes para bloquear llamadas", async () => {
  const agent = testPort();
  vi.mocked(agent.inbox).mockResolvedValue([]);
  vi.mocked(agent.status).mockRejectedValue(new BrokerError("not_found", "No se encontró la solicitud."));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwksOrigin = await listen(createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      keys: [{ ...publicKey.export({ format: "jwk" }), kid: "oauth-test", alg: "EdDSA" }],
    }));
  }));
  const origin = await listen(createHttpServer({ audience, issuer, jwksUrl: `${jwksOrigin}/jwks` }, agent));
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function token(scope: string) {
    const jwt = `${encode({ typ: "at+jwt", alg: "EdDSA", kid: "oauth-test" })}.${encode({
      iss: issuer, aud: audience, sub: "oauth-user", azp: "oauth-agent",
      scope, exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    return `${jwt}.${sign(null, Buffer.from(jwt), privateKey).toString("base64url")}`;
  }
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
  await expect(limited.request({
    method: "events/subscribe",
    params: { name: WAKE_EVENT, delivery: { mode: "webhook", url: "https://callback.example.test/sideband", secret: `whsec_${Buffer.alloc(32).toString("base64")}` } },
  }, z.looseObject({}))).rejects.toMatchObject({ code: -32000, data: { code: "forbidden" } });
  await expect(limited.request({ method: "events/unsubscribe", params: { id: "sub_0123456789abcdef" } }, z.looseObject({})))
    .rejects.toMatchObject({ code: -32000, data: { code: "forbidden" } });
  expect(agent.connectWake).not.toHaveBeenCalled();
  expect(agent.disconnectWake).not.toHaveBeenCalled();
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
    }],
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
});
