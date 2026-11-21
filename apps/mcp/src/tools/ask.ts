import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker/client";
import { AskInput, ToolArgs, ToolName, type Principal } from "@team-31/protocol";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

// The SDK advertises a top-level object. AskInput checks the tool/args pairing.
const inputSchema = AskInput.options[0].extend({
  tool: ToolName,
  args: z.union(Object.values(ToolArgs)),
});

export function registerAsk(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_ask", {
    description: "Pide a otra persona disponibilidad (availability), coincidencia de interés (interest_check), una respuesta (question) o conectar como amigos (connect, con args vacío). Consulta el resultado con sideband_check.",
    inputSchema,
  }, (args) => runTool(telemetry, principal, { tool: "sideband_ask", scope: "sideband:ask" }, () => {
    const input = AskInput.safeParse(args);
    if (!input.success) throw new BrokerError("invalid_input", "Los argumentos no corresponden a la herramienta.");
    return agent.ask(principal, input.data);
  }));
}
