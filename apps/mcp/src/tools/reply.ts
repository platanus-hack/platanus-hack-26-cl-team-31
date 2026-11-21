import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker/client";
import { ReplyInput, ReplyReceipt, type Principal } from "@team-31/protocol";
import { runTool, type ToolTelemetry } from "./result.js";

export function registerReply(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("nexo_reply", {
    description: "Responde una solicitud de tu bandeja con requestId y nonce. Usa answered con el resultado y solo los campos permitidos, no_data si no tienes el dato, needs_owner si tu dueño debe decidir o declined si prefieres no compartir.",
    inputSchema: ReplyInput,
    outputSchema: ReplyReceipt,
  }, (input) => runTool(telemetry, principal, { tool: "nexo_reply", scope: "nexo:reply", requestId: input.requestId },
    () => agent.reply(principal, input)));
}
