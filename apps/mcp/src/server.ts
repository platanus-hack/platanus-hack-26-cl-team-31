import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker/client";
import type { Principal } from "@team-31/protocol";
import { registerEvents } from "./events.js";
import { instructions } from "./instructions.js";
import { registerAsk } from "./tools/ask.js";
import { registerInbox } from "./tools/inbox.js";
import { registerReply } from "./tools/reply.js";
import { registerCheck } from "./tools/check.js";

export function createServer(principal: Principal, agentPort: AgentPort): McpServer {
  const server = new McpServer({ name: "nexo", version: "0.1.0" }, { instructions });
  registerAsk(server, principal, agentPort);
  registerInbox(server, principal, agentPort);
  registerReply(server, principal, agentPort);
  registerCheck(server, principal, agentPort);
  registerEvents(server, principal, agentPort);
  return server;
}
