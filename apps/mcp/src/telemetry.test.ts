import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BrokerError, createAgentClient, type AgentPort } from "@team-31/broker/client";
import { WAKE_EVENT } from "@team-31/protocol";
import { createTelemetry, memorySink, tracedFetch, type MemorySink, type Telemetry } from "@team-31/telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpServer } from "./http.js";
import { createServiceTokenMinter } from "./service-token.js";
import { mcpSink } from "./telemetry.js";
import { runTool } from "./tools/result.js";

const servers: Server[] = [];
const clients: Client[] = [];
const audience = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test/api/auth";
const options = { audience, issuer, jwksUrl: `${issuer}/jwks`, devAuth: true };
const secretText = "pregunta privada";
const question = { to: "bob@sideband.app", tool: "question", args: { text: secretText, category: "general" } };

let sink: MemorySink;
let telemetry: Telemetry;

beforeEach(() => {
  sink = memorySink();
  telemetry = createTelemetry({ service: "mcp", sink, heartbeatMs: 0, lifecycle: false });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto HTTP de prueba.");
  return `http://127.0.0.1:${address.port}`;
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "sideband-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

function port(overrides: Partial<AgentPort> = {}): AgentPort {
  return {
    capabilities: vi.fn(), ask: vi.fn(), inbox: vi.fn(), reply: vi.fn(), status: vi.fn(), contacts: vi.fn(),
    vaultCatalog: vi.fn(), changeVault: vi.fn(), queryVault: vi.fn(),
    connectWake: vi.fn(), disconnectWake: vi.fn(), ...overrides,
  };
}

describe("telemetría del MCP", () => {
  it("registra la autenticación, cada tool y propaga traceparent al broker", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const headers: Record<string, string | undefined>[] = [];
    const broker = await listen(createServer((req, res) => {
      headers.push({ traceparent: String(req.headers.traceparent ?? "") });
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        requestId: "request-1", to: "bob@sideband.app", tool: "question", expiresAt: "2026-11-22T00:00:00Z",
        decision: "pending", final: false, waitingFor: "agent",
      }));
    }));
    const agent = createAgentClient({
      baseUrl: broker,
      getServiceToken: createServiceTokenMinter(JSON.stringify(privateKey.export({ format: "jwk" }))),
      fetch: tracedFetch(telemetry),
    });
    const origin = await listen(createHttpServer(options, agent, telemetry));
    const client = await connect(`${origin}/mcp`, "dev:ana:ana-bot");
    await client.callTool({ name: "sideband_ask", arguments: question });

    const [tool] = sink.find("mcp.tool.call");
    expect(tool).toMatchObject({
      service: "mcp", userId: "ana", agentId: "ana-bot", requestId: "request-1", status: "ok",
      attrs: { tool: "sideband_ask", outcome: "ok" },
    });
    const parent = sink.find("http.request").find((span) => span.spanId === tool?.parentSpanId);
    expect(parent).toMatchObject({ traceId: tool?.traceId, userId: "ana", attrs: { method: "POST", route: "/mcp", status: 200 } });
    // The broker receives the trace and, as parent, the tool span (or a child of it).
    const traceparent = headers.at(-1)?.traceparent ?? "";
    expect(traceparent).toMatch(new RegExp(`^00-${tool?.traceId}-[0-9a-f]{16}-01$`));
    expect(sink.find("auth.token.verified")[0]?.attrs).toEqual({ issuer: "dev", reason: "dev_token" });

    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain("dev:ana");
  });

  it("registra tokens rechazados, permisos faltantes y errores sin mensajes", async () => {
    const agent = port({
      inbox: vi.fn().mockRejectedValue(new Error("detalle privado de la red")),
      status: vi.fn().mockRejectedValue(new BrokerError("not_found", "No se encontró la solicitud.")),
    });
    const origin = await listen(createHttpServer(options, agent, telemetry));
    const response = await fetch(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-trace-id")).toMatch(/^[0-9a-f]{32}$/);
    expect(sink.find("auth.token.rejected")[0]?.attrs).toEqual({ issuer, reason: "missing_token" });

    const client = await connect(`${origin}/mcp`, "dev:ana:ana-bot");
    expect((await client.callTool({ name: "sideband_inbox" })).isError).toBe(true);
    expect((await client.callTool({ name: "sideband_check", arguments: { requestId: "missing" } })).isError).toBe(true);

    const calls = sink.find("mcp.tool.call");
    expect(calls.map((call) => [call.attrs.tool, call.attrs.outcome, call.status])).toEqual([
      ["sideband_inbox", "error", "error"],
      ["sideband_check", "error", "ok"],
    ]);
    const [error] = sink.find("error");
    expect(error).toMatchObject({ userId: "ana", attrs: { operation: "mcp.tool.call sideband_inbox", type: "Error" } });
    expect(calls[0]?.errorId).toBe(error?.errorId);
    expect(calls[1]?.requestId).toBe("missing");
    expect(JSON.stringify(sink.records)).not.toContain("detalle privado");
  });

  it("registra la denegación por permiso faltante", async () => {
    // Dev tokens carry every scope, so the limited principal goes straight to runTool.
    const result = await runTool(telemetry, { userId: "ana", agentId: "ana-bot", scopes: ["sideband:status"] },
      { tool: "sideband_ask", scope: "sideband:ask" }, async () => ({}));
    expect(result.isError).toBe(true);
    expect(sink.find("mcp.tool.call")[0]?.attrs).toEqual({ tool: "sideband_ask", outcome: "denied" });
    expect(sink.find("auth.scope.denied")).toEqual([expect.objectContaining({
      userId: "ana", agentId: "ana-bot", attrs: { scope: "sideband:ask", operation: "sideband_ask" },
    })]);
  });

  it("observa events/subscribe como una tool", async () => {
    const agent = port({ connectWake: vi.fn().mockRejectedValue(new Error("fallo privado")) });
    const origin = await listen(createHttpServer(options, agent, telemetry));
    const client = await connect(`${origin}/mcp`, "dev:ana:ana-bot");
    const params = {
      name: WAKE_EVENT,
      delivery: { mode: "webhook", url: "https://callback.example.test/sideband", secret: `whsec_${Buffer.alloc(32).toString("base64")}` },
    };
    await expect(client.request({ method: "events/subscribe", params }, z.looseObject({})))
      .rejects.toMatchObject({ code: -32603 });
    expect(sink.find("mcp.tool.call")).toEqual([expect.objectContaining({
      status: "error", attrs: { tool: "events/subscribe", outcome: "error" },
    })]);
    expect(sink.find("error")).toHaveLength(1);
    expect(JSON.stringify(sink.records)).not.toContain(params.delivery.secret);
  });

  it("en stdio nunca escribe telemetría en stdout", () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const own = createTelemetry({ service: "mcp", sink: mcpSink(true, { TELEMETRY_SINK: "console" }), heartbeatMs: 0 });
      own.emit("mcp.tool.call", { attrs: { tool: "sideband_ask", outcome: "ok" } });
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
