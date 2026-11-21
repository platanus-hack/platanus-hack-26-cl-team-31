import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker-client";
import type { Principal } from "@team-31/protocol";
import type { Telemetry } from "@team-31/telemetry";
import { registerMessage, type HandleMessage } from "./tools/message.js";
import { registerEvents } from "./events.js";
import { messageInstructions, instructions } from "./instructions.js";
import { registerAsk } from "./tools/ask.js";
import { registerInbox } from "./tools/inbox.js";
import { registerReply } from "./tools/reply.js";
import { registerCheck } from "./tools/check.js";
import { registerContacts } from "./tools/contacts.js";
import { registerVault } from "./tools/vault.js";

export function createServer(principal: Principal, agentPort: AgentPort, telemetry: Telemetry, messages?: HandleMessage): McpServer {
  const server = new McpServer({ name: "sideband", version: "0.1.0" }, { instructions: messages ? messageInstructions : instructions });
  registerAsk(server, principal, agentPort, telemetry);
  registerInbox(server, principal, agentPort, telemetry);
  registerReply(server, principal, agentPort, telemetry);
  registerCheck(server, principal, agentPort, telemetry);
  registerContacts(server, principal, agentPort, telemetry);
  registerVault(server, principal, agentPort, telemetry);
  if (messages) registerMessage(server, principal, agentPort, telemetry, messages);
  registerEvents(server, principal, agentPort, telemetry);
  return server;
}
