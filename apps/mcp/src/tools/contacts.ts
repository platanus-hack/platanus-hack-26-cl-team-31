import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker-client";
import { agentScopes, type Principal } from "@team-31/protocol";
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
  }, () => runTool(telemetry, principal, { tool: "sideband_contacts", scope: agentScopes.contacts },
    () => agent.contacts(principal)));

  server.registerTool("search_public_profiles", {
    description: "Busca perfiles públicos por nombre o dirección cuando el titular pide descubrir personas en Sideband.",
    annotations: { readOnlyHint: true },
    inputSchema: routes.agentSearchPublicProfiles.body,
    outputSchema: routes.agentSearchPublicProfiles.response,
  }, ({ query }) => runTool(telemetry, principal, { tool: "search_public_profiles", scope: agentScopes.searchPublicProfiles },
    async () => ({ items: await agent.searchPublicProfiles(principal, query) })));
  server.registerTool("sideband_network_users", {
    description: "Lista las direcciones de quienes conectaron un agente a Sideband alguna vez, incluidos quienes no son contactos. Con q busca parte de la dirección. Para la página siguiente conserva q y pasa nextCursor como after.",
    annotations: { readOnlyHint: true },
    inputSchema: routes.agentNetworkUsers.query, outputSchema: routes.agentNetworkUsers.response,
  }, ({ after, q }) => runTool(telemetry, principal, { tool: "sideband_network_users", scope: agentScopes.networkUsers },
    () => agent.networkUsers(principal, after, q)));
}
