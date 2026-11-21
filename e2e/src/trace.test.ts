// In-process trace across services: an MCP request reaches the real broker HTTP server and both
// write to the same sink. Runs without the local stack (no E2E_MCP_URL needed).
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { applyPostgresMigrations, createPostgresStore } from "@team-31/broker/postgres";
import { connectAgent } from "./agents.js";
import { createAgentClient } from "@team-31/broker/client";
import { createMessageRuntime } from "@team-31/message-flow/runtime";
import { RequesterView } from "@team-31/protocol";
import { z } from "zod";
import { applyOpsMigrations } from "@team-31/ops";
import {
  createTelemetry,
  memorySink,
  postgresSink,
  tracedFetch,
  type TelemetryRecord,
  type TelemetrySink,
} from "@team-31/telemetry";
import { createTestDatabase } from "@team-31/test-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer as createBrokerHttp } from "../../apps/broker/src/http/server.js";
import { createHttpServer as createMcpHttp } from "../../apps/mcp/src/http.js";
import { createServiceTokenMinter } from "../../apps/mcp/src/service-token.js";

const cleanup: Array<() => Promise<unknown>> = [];
const secretText = "pregunta privada de la traza";

afterEach(async () => {
  try { for (const step of cleanup.splice(0).reverse()) await step(); } finally { vi.unstubAllEnvs(); }
});

async function listen(server: ServerType) {
  if (!server.listening) await once(server, "listening");
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Starts broker and MCP with their own telemetry over one sink and asks one question. */
async function startStack(sink: TelemetrySink, store = createMemoryStore(), enableMessages = false) {
  const mcpKey = generateKeyPairSync("ed25519");
  const signing = generateKeyPairSync("ed25519");
  const brokerTelemetry = createTelemetry({ service: "broker", sink, heartbeatMs: 0, lifecycle: false });
  const mcpTelemetry = createTelemetry({ service: "mcp", sink, heartbeatMs: 0, lifecycle: false });

  const broker = createBroker({
    store,
    waker: { wake: vi.fn().mockResolvedValue({ ok: true, retryable: false, ms: 1 }), verifyCallback: vi.fn() },
    clock: { now: () => new Date() },
    signingKey: signing.privateKey,
    nonceKey: new Uint8Array(32),
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 0, 0], addressDomain: "sideband.app" },
    telemetry: brokerTelemetry,
  });
  await broker.owner.claimAddress({ userId: "ana" }, "ana");
  await broker.owner.claimAddress({ userId: "bob" }, "bob");
  const grant = await broker.owner.setGrant({ userId: "bob" }, { grantee: "ana@sideband.app", category: "general" });

  const brokerApp = createBrokerHttp({
    broker, publicKeys: { mcp: mcpKey.publicKey.export({ format: "jwk" }) }, telemetry: brokerTelemetry,
  });
  const brokerUrl = await listen(serve({ fetch: brokerApp.fetch, hostname: "127.0.0.1", port: 0 }));

  const agent = createAgentClient({
    baseUrl: brokerUrl,
    getServiceToken: createServiceTokenMinter(JSON.stringify(mcpKey.privateKey.export({ format: "jwk" }))),
    fetch: tracedFetch(mcpTelemetry),
  });
  const audience = "https://mcp.example.test/mcp";
  const issuer = "https://auth.example.test/api/auth";
  async function startMcp() {
    const messages = enableMessages ? createMessageRuntime(mcpTelemetry) : undefined;
    if (messages) cleanup.push(messages.close);
    const mcpServer = createMcpHttp({ audience, issuer, jwksUrl: `${issuer}/jwks`, devAuth: true }, agent, mcpTelemetry, messages?.handleMessage);
    mcpServer.listen(0, "127.0.0.1");
    return listen(mcpServer);
  }
  const mcpUrl = await startMcp();

  async function connect(user: string, origin = mcpUrl) {
    const agent = await connectAgent(new URL(`${origin}/mcp`), `dev:${user}:${user}-bot`);
    cleanup.push(agent.close);
    return agent;
  }
  return { connect, startMcp, owner: broker.owner, revoke: () => broker.owner.revokeGrant({ userId: "bob" }, grant.id),
    flush: () => Promise.all([brokerTelemetry.flush(), mcpTelemetry.flush()]) };
}

const question = { to: "bob@sideband.app", tool: "question", args: { text: secretText, category: "general" } } as const;
async function askThroughMcp(sink: TelemetrySink) {
  const stack = await startStack(sink);
  const ana = await stack.connect("ana");
  const { requestId } = await ana.ask(question);
  await stack.flush();
  return requestId;
}

type Row = Pick<TelemetryRecord, "service" | "name" | "traceId" | "spanId" | "parentSpanId" | "requestId">;

function expectOneTrace(rows: Row[], requestId: string) {
  const tool = rows.find((row) => row.service === "mcp" && row.name === "mcp.tool.call");
  expect(tool).toMatchObject({ requestId });
  const traceId = tool?.traceId;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);

  const trace = rows.filter((row) => row.traceId === traceId);
  const brokerSpan = trace.find((row) => row.service === "broker" && row.name === "http.request" && row.requestId === requestId);
  // The broker span hangs from the MCP tool span: same trace, same request.
  expect(brokerSpan).toMatchObject({ requestId, parentSpanId: tool?.spanId });
  expect(trace.find((row) => row.service === "mcp" && row.name === "http.request")?.spanId).toBe(tool?.parentSpanId);
  for (const name of ["broker.policy.evaluated", "broker.request.created"]) {
    expect(trace.find((row) => row.name === name)).toMatchObject({ service: "broker", requestId, parentSpanId: brokerSpan?.spanId });
  }
  expect(new Set(trace.filter((row) => row.requestId).map((row) => row.requestId))).toEqual(new Set([requestId]));
}

describe("traza de punta a punta MCP → broker", () => {
  it("una solicitud por el MCP deja spans de mcp y broker con el mismo trace_id y request_id", async () => {
    const sink = memorySink();
    const requestId = await askThroughMcp(sink);
    expectOneTrace(sink.records, requestId);
    expect(JSON.stringify(sink.records)).not.toContain(secretText);
  });

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  it.skipIf(!testDatabaseUrl && !process.env.CI)("revocar bloquea tanto la respuesta pendiente como la ya guardada antes de leerla", async () => {
    const db = await createTestDatabase("revoke_test");
    cleanup.push(() => db.drop());
    await applyPostgresMigrations({ databaseUrl: db.url });
    const store = createPostgresStore({ databaseUrl: db.url, secretsKey: Buffer.alloc(32, 3).toString("base64") });
    cleanup.push(() => store.close());
    const stack = await startStack(memorySink(), store);
    const ana = await stack.connect("ana");
    const bob = await stack.connect("bob");
    await ana.ask(question);
    await ana.ask(question);
    const inbox = await bob.inbox();
    expect(inbox).toHaveLength(2);
    const [saved, pending] = inbox;
    const result = { answer: "Respuesta privada de prueba" };
    await bob.reply({ requestId: saved!.requestId, nonce: saved!.nonce, outcome: "answered", result });
    await stack.revoke();
    await expect(bob.reply({ requestId: pending!.requestId, nonce: pending!.nonce, outcome: "answered", result }))
      .rejects.toMatchObject({ code: "conflict" });
    for (const { requestId } of inbox) {
      const view = await ana.check(requestId);
      expect(view).toMatchObject({ final: true, decision: "deny" });
      expect(view).not.toHaveProperty("result");
    }
  }, 30_000);
  // CREATE DATABASE + migrations on a loaded CI box can exceed Vitest's default 5 s.
  it.skipIf(!testDatabaseUrl)("la misma traza queda en ops.events", async () => {
    // drop() waits for the backends to leave before dropping (the race from #89).
    const testDb = await createTestDatabase("trace_test");
    cleanup.push(() => testDb.drop());
    const databaseUrl = testDb.url;
    const db = testDb.pool();
    await applyOpsMigrations({ databaseUrl });

    const sink = postgresSink(databaseUrl);
    cleanup.push(() => sink.close());
    const requestId = await askThroughMcp(sink);
    const { rows } = await db.query<Row>(`
      SELECT service, name, trace_id AS "traceId", span_id AS "spanId", parent_span_id AS "parentSpanId",
             request_id AS "requestId"
      FROM ops.events ORDER BY id`);
    expectOneTrace(rows, requestId);
    const { rows: [leak] } = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ops.events WHERE attrs::text LIKE $1", [`%${secretText}%`],
    );
    expect(leak?.count).toBe(0);
  }, 30_000);
});


it.skipIf(!process.env.TEST_DATABASE_URL && !process.env.CI)("resuelve una amiga ambigua por MCP y reanuda en otra réplica con un solo envío", async () => {
  const db = await createTestDatabase("message_e2e");
  cleanup.push(() => db.drop());
  await applyPostgresMigrations({ databaseUrl: db.url });
  const store = createPostgresStore({ databaseUrl: db.url, secretsKey: Buffer.alloc(32, 7).toString("base64") });
  cleanup.push(() => store.close());

  // Exercise the real Anthropic Messages client and its structured-output parser over loopback.
  const userText = "¿A mi amiga Ana le interesa la cerámica?";
  const providerCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const provider = await listen(serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const body = await req.json() as Record<string, unknown>;
    providerCalls.push({ path: new URL(req.url).pathname, body });
    return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: body.model,
      content: [{ type: "tool_use", id: "toolu_fixture", name: "interpret_sideband_message", input: { intent: {
        action: "ask", selector: { scope: "friend", count: "one", person: "Ana" },
        tool: "interest_check", args: { interest: "cerámica" },
      } } }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 32, output_tokens: 20 },
    });
  } }));
  vi.stubEnv("ANTHROPIC_API_URL", provider);
  vi.stubEnv("ANTHROPIC_BASE_URL", provider);
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  vi.stubEnv("MESSAGE_FLOW_DATABASE_URL", db.url);
  vi.stubEnv("MESSAGE_FLOW_MODEL", "claude-haiku-4-5");

  const sink = memorySink();
  const stack = await startStack(sink, store, true);
  const sql = db.pool();
  for (const [name, tag] of [["ana.soto", "friend"], ["ana.vera", "friend"], ["ana.rios", "work"]] as const) {
    const recipient = { userId: name };
    const address = await stack.owner.claimAddress(recipient, name);
    await sql.query("UPDATE sideband.users SET display_name = $1 WHERE user_id = $2", ["Ana", name]);
    const invitation = await stack.owner.connect({ userId: "bob" }, address, [], tag);
    await stack.owner.answerInvitation(recipient, invitation.requestId, { accept: true, share: ["interests"] });
  }
  const bob = await stack.connect("bob");
  const clarification = await bob.call("sideband_message", { text: userText }, z.object({
    kind: z.literal("clarification"), question: z.string(), continuationId: z.string(),
    choices: z.array(z.object({ label: z.string(), value: z.string() })),
  }));
  expect(clarification.choices.map(choice => choice.value)).toEqual(["ana.soto@sideband.app", "ana.vera@sideband.app"]);
  const interests = () => sql.query("SELECT id, to_address, args FROM sideband.requests WHERE tool = 'interest_check'");
  expect((await interests()).rows).toEqual([]);

  // The second MCP and its pool share only the durable database state with the first replica.
  const resumed = await stack.connect("bob", await stack.startMcp());
  const input = { text: "la segunda", continuationId: clarification.continuationId };
  const reply = z.object({ kind: z.literal("requests"), unconfirmedCount: z.literal(0), continuationId: z.string(), items: z.array(RequesterView) });
  const first = await resumed.call("sideband_message", input, reply);
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ to: "ana.vera@sideband.app", tool: "interest_check", decision: "pending" });
  const replay = await bob.call("sideband_message", input, reply);
  expect(replay.items).toEqual(first.items);
  expect((await interests()).rows).toEqual([{ id: first.items[0]!.requestId, to_address: "ana.vera@sideband.app", args: { interest: "cerámica" } }]);

  expect(providerCalls).toHaveLength(1);
  expect(providerCalls[0]).toMatchObject({ path: "/v1/messages", body: { tools: [{ name: "interpret_sideband_message" }] } });
  expect(JSON.stringify(providerCalls[0]!.body.messages)).toContain(userText);
  expect(JSON.stringify(providerCalls[0]!.body.messages)).not.toContain("ana.vera");
  await stack.flush();
  expect(sink.records.some(event => event.name === "broker.ask.relation_checked" && event.attrs.matches === true)).toBe(true);
  expect(JSON.stringify(sink.records)).not.toContain("cerámica");
}, 30_000);
