import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker/client";
import { agentScopes, ReplyArguments, ReplyInput, ReplyReceipt, type Principal } from "@team-31/protocol";
import { runTool, type ToolTelemetry } from "./result.js";

export function registerReply(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_reply", {
    description: "Responde una solicitud de tu bandeja con requestId y nonce. Usa answered con el resultado y solo los campos permitidos, no_data si no tienes el dato, needs_owner si tu dueño debe decidir o declined si prefieres no compartir.",
    inputSchema: ReplyArguments,
    outputSchema: ReplyReceipt,
  }, (input) => runTool(telemetry, principal, { tool: "sideband_reply", scope: agentScopes.reply, requestId: input.requestId }, () => {
    const parsed = ReplyInput.safeParse(input);
    if (!parsed.success) throw new BrokerError("invalid_input", "La respuesta no cumple el formato requerido.");
    return agent.reply(principal, parsed.data);
  }));
}
