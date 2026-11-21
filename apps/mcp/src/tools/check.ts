import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker/client";
import type { Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { runTool } from "./result.js";

export function registerCheck(server: McpServer, principal: Principal, agent: AgentPort) {
  server.registerTool("nexo_check", {
    description: "Consulta el estado o la respuesta final de una solicitud que enviaste usando su requestId.",
    annotations: { readOnlyHint: true },
    inputSchema: { requestId: routes.agentStatus.params.shape.id },
  }, ({ requestId }) => runTool(principal, "nexo:status", () => agent.status(principal, requestId)));
}
