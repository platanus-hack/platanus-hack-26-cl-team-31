import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker-client";
import type { Principal } from "@team-31/protocol";
import { silentTelemetry } from "@team-31/telemetry";
import { expect, it, onTestFinished, vi } from "vitest";
import { registerReply } from "./reply.js";

it("conserva la lista vacía de categorías al aceptar una invitación sin compartir datos", async () => {
  const principal: Principal = { userId: "bob", agentId: "bob-bot", scopes: ["sideband:reply", "sideband:accept"] };
  const input = { requestId: "invitation-1", nonce: "nonce-1", outcome: "answered", result: { accepted: true }, share: [] };
  const reply = vi.fn<AgentPort["reply"]>().mockResolvedValue({
    requestId: input.requestId, status: "answered", deliveredFields: ["accepted"], droppedFields: [],
  });
  const server = new McpServer({ name: "sideband", version: "1" });
  registerReply(server, principal, { reply }, silentTelemetry("mcp"));
  const client = new Client({ name: "sideband-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  await client.callTool({ name: "sideband_reply", arguments: input });
  expect(reply).toHaveBeenCalledExactlyOnceWith(principal, input);
});
