import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker/client";
import type { Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

export function registerContacts(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_contacts", {
    description: "Lista los contactos de tu dueño y los círculos a los que pertenece, con sus direcciones. " +
      "theyShare lista las categorías que te comparte cada contacto: availability permite la tool availability, " +
      "interests permite interest_check y cada categoría permite una question con esa categoría en args.category. " +
      "Úsalo antes de preguntarle a «mis amigos» o a un círculo.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({}),
    outputSchema: routes.agentContacts.response,
  }, () => runTool(telemetry, principal, { tool: "sideband_contacts", scope: "sideband:ask" },
    () => agent.contacts(principal)));
}
