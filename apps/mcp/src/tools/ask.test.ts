import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker-client";
import type { Principal } from "@team-31/protocol";
import { silentTelemetry } from "@team-31/telemetry";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerAsk } from "./ask.js";

const principal: Principal = { userId: "ana", agentId: "ana-bot", scopes: ["sideband:ask", "sideband:vault"] };
const to = "bob@sideband.app";
const ask = vi.fn<AgentPort["ask"]>();
let client: Client;
let server: McpServer;

beforeEach(async () => {
  ask.mockReset();
  server = new McpServer({ name: "sideband", version: "1" });
  registerAsk(server, principal, { ask }, silentTelemetry("mcp"));
  client = new Client({ name: "sideband-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

it("rechaza una question con argumentos de interest_check antes de llamar al broker", async () => {
  const result = await client.callTool({
    name: "sideband_ask", arguments: { to, tool: "question", args: { interest: "cerámica" } },
  });
  expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "invalid_input" } } });
  expect(ask).not.toHaveBeenCalled();
});

it.each([{ tags: [] }, { tags: ["friend", "work"] }])("conserva la elección de etiquetas $tags al invitar", async ({ tags }) => {
  const invitation = { to, tool: "connect", args: { share: ["interests"] }, tags };
  const pending = {
    to, tool: "connect", decision: "pending", final: false, waitingFor: "agent",
    requestId: "request-1", expiresAt: "2026-11-22T00:00:00Z",
  } as const;
  ask.mockResolvedValue(pending);

  const result = await client.callTool({ name: "sideband_ask", arguments: invitation });
  expect(ask).toHaveBeenCalledExactlyOnceWith(principal, invitation);
  expect(result.structuredContent).toEqual(pending);
});
