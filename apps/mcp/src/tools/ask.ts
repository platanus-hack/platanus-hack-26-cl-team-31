import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker-client";
import { agentScopes, AskInput, ToolArgs, ToolName, type Principal } from "@team-31/protocol";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

// The SDK advertises a top-level object. AskInput checks the tool/args pairing.
const inputSchema = AskInput.options[0].extend({
  tool: ToolName,
  tags: AskInput.options[4].shape.tags.describe("Solo para connect: IDs de las etiquetas elegidas por el titular, o [] para Sin etiqueta."),
  args: z.union(Object.values(ToolArgs)),
}).meta({
  if: { properties: { tool: { const: "connect" } } },
  then: { required: ["tags"] },
});

export function registerAsk(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_ask", {
    description: "Pide disponibilidad, coincidencia de interés, una respuesta o conectar. Para connect pregunta al titular qué etiquetas ponerle al contacto si no lo indicó; envía su elección en tags ([] para Sin etiqueta). Una question indica el tema en args.category. Consulta el resultado con sideband_check.",
    inputSchema,
  }, (args) => runTool(telemetry, principal, { tool: "sideband_ask", scope: agentScopes.ask }, () => {
    const input = AskInput.safeParse(args);
    if (!input.success) throw new BrokerError("invalid_input", "Los argumentos no corresponden a la herramienta.");
    if (input.data.tool === "connect" && input.data.tags === undefined)
      throw new BrokerError("invalid_input", "Pregunta al titular qué etiquetas ponerle al contacto. Indica tags o [] si eligió Sin etiqueta.");
    return agent.ask(principal, input.data);
  }));
}
