import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker/client";
import { AskInput, ToolArgs, ToolName, type Principal } from "@team-31/protocol";
import { z } from "zod";
import { runTool } from "./result.js";

// The SDK advertises a top-level object. AskInput checks the tool/args pairing.
const inputSchema = AskInput.options[0].extend({
  tool: ToolName,
  args: z.union(Object.values(ToolArgs)),
});

export function registerAsk(server: McpServer, principal: Principal, agent: AgentPort) {
  server.registerTool("nexo_ask", {
    description: "Pide a otra persona su perfil público (profile), disponibilidad (availability), coincidencia de interés (interest_check), una respuesta (question) o conectar como amigos (connect, con args vacío). Consulta el resultado con nexo_check.",
    inputSchema,
  }, (args) => runTool(principal, "nexo:ask", () => {
    const input = AskInput.safeParse(args);
    if (!input.success) throw new BrokerError("invalid_input", "Los argumentos no corresponden a la herramienta.");
    return agent.ask(principal, input.data);
  }));
}
