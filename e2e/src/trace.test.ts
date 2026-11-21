// In-process trace across services: an MCP request reaches the real broker HTTP server and both
// write to the same sink. Runs without the local stack (no E2E_MCP_URL needed).
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { createAgentClient } from "@team-31/broker/client";
import { applyOpsMigrations } from "@team-31/ops";
import {
  createTelemetry,
  memorySink,
  postgresSink,
  tracedFetch,
  type TelemetryRecord,
  type TelemetrySink,
} from "@team-31/telemetry";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer as createBrokerHttp } from "../../apps/broker/src/http/server.js";
import { createHttpServer as createMcpHttp } from "../../apps/mcp/src/http.js";
import { createServiceTokenMinter } from "../../apps/mcp/src/service-token.js";

const cleanup: Array<() => Promise<unknown>> = [];
const secretText = "pregunta privada de la traza";

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function listen(server: ServerType) {
  if (!server.listening) await once(server, "listening");
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Starts broker and MCP with their own telemetry over one sink and asks one question. */
async function askThroughMcp(sink: TelemetrySink) {
  const mcpKey = generateKeyPairSync("ed25519");
  const signing = generateKeyPairSync("ed25519");
  const brokerTelemetry = createTelemetry({ service: "broker", sink, heartbeatMs: 0, lifecycle: false });
  const mcpTelemetry = createTelemetry({ service: "mcp", sink, heartbeatMs: 0, lifecycle: false });

  const broker = createBroker({
    store: createMemoryStore(),
    waker: { wake: vi.fn().mockResolvedValue({ ok: true, retryable: false, ms: 1 }), verifyCallback: vi.fn() },
    clock: { now: () => new Date() },
    signingKey: signing.privateKey,
    nonceKey: new Uint8Array(32),
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 0, 0], addressDomain: "sideband.app" },
    telemetry: brokerTelemetry,
  });
  await broker.owner.claimAddress({ userId: "ana" }, "ana");
  await broker.owner.claimAddress({ userId: "bob" }, "bob");
  await broker.owner.setGrant({ userId: "bob" }, { grantee: "ana@sideband.app", category: "general" });

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
  const mcpServer = createMcpHttp({ audience, issuer, jwksUrl: `${issuer}/jwks`, devAuth: true }, agent, mcpTelemetry);
  mcpServer.listen(0, "127.0.0.1");
  const mcpUrl = await listen(mcpServer);

  const client = new Client({ name: "trace-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer dev:ana:ana-bot" } },
  }));
  cleanup.push(() => client.close());
  const result = await client.callTool({
    name: "sideband_ask", arguments: { to: "bob@sideband.app", tool: "question", args: { text: secretText } },
  });
  const requestId = (result.structuredContent as { requestId: string }).requestId;
  await Promise.all([brokerTelemetry.flush(), mcpTelemetry.flush()]);
  return requestId;
}

type Row = Pick<TelemetryRecord, "service" | "name" | "traceId" | "spanId" | "parentSpanId" | "requestId">;

function expectOneTrace(rows: Row[], requestId: string) {
  const tool = rows.find((row) => row.service === "mcp" && row.name === "mcp.tool.call");
  expect(tool).toMatchObject({ requestId });
  const traceId = tool?.traceId;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);

  const trace = rows.filter((row) => row.traceId === traceId);
  const brokerSpan = trace.find((row) => row.service === "broker" && row.name === "http.request");
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
  it.skipIf(!testDatabaseUrl)("la misma traza queda en ops.events", async () => {
    const url = new URL(testDatabaseUrl!);
    if (!url.pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
    const admin = new pg.Pool({ connectionString: testDatabaseUrl });
    const name = "trace_test_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    url.pathname = "/" + name;
    const databaseUrl = url.toString();
    const db = new pg.Pool({ connectionString: databaseUrl });
    cleanup.push(async () => {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
      await admin.end();
    });
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
  });
});
