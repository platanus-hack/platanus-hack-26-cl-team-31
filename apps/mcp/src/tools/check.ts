import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker/client";
import type { Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { runTool, type ToolTelemetry } from "./result.js";

export function registerCheck(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("nexo_check", {
    description: "Consulta el estado o la respuesta final de una solicitud que enviaste usando su requestId.",
    annotations: { readOnlyHint: true },
    inputSchema: { requestId: routes.agentStatus.params.shape.id },
  }, ({ requestId }) => runTool(telemetry, principal, { tool: "nexo_check", scope: "nexo:status", requestId },
    () => agent.status(principal, requestId)));
}
