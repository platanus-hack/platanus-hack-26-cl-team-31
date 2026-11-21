import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker-client";
import { MessageInput, type MessageReply, type TurnContext } from "@team-31/message-flow";
import { agentScopes, type Principal, type Scope } from "@team-31/protocol";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

export type HandleMessage = (context: TurnContext, input: MessageInput) => Promise<MessageReply>;

export function registerMessage(
  server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry, handleMessage: HandleMessage,
) {
  const tool = "sideband_message";
  function permitted<T>(scope: Scope, run: () => Promise<T>) {
    if (principal.scopes.includes(scope)) return run();
    telemetry.emit("auth.scope.denied", { userId: principal.userId, agentId: principal.agentId, attrs: { scope, operation: tool } });
    throw new BrokerError("forbidden", "Tu conexión necesita autorización para esta operación.");
  }
  // A narrower credential cannot resume data selected with broader scopes.
  const binding = JSON.stringify(["mcp", principal.agentId, [...new Set(principal.scopes)].sort()]);
  const context: TurnContext = {
    userId: principal.userId, agentId: principal.agentId, binding,
    ops: {
      invitationGroups: principal.scopes.includes(agentScopes.contactGroups) ? async () => ({
        ...await agent.contactGroups(principal), ...await agent.vaultCatalog(principal),
      }) : undefined,
      contacts: () => permitted(agentScopes.contacts, () => agent.contacts(principal)),
      ask: input => permitted(agentScopes.ask, () => agent.ask(principal, input)),
      status: id => permitted(agentScopes.status, () => agent.status(principal, id)),
      queryVault: query => permitted(agentScopes.queryVault, () => agent.queryVault(principal, query)),
      searchProfiles: query => permitted(agentScopes.searchPublicProfiles, () => agent.searchPublicProfiles(principal, query)),
    },
  };
  server.registerTool(tool, {
    description: "Coordina una petición del titular a partir de su mensaje original. Devuelve datos, recibos o una aclaración. " +
      "Para responder o consultar ese turno, envía el continuationId recibido y las palabras del titular.",
    inputSchema: MessageInput.extend({ messageId: z.uuid().optional().describe("UUID único de este mensaje. Reutilízalo al reintentar la misma entrega.") }),
  }, ({ messageId, ...input }) => runTool(telemetry, principal, {
    tool, scope: principal.scopes.includes(agentScopes.ask) ? agentScopes.ask : agentScopes.status,
  }, () => handleMessage({ ...context, deliveryId: messageId }, input)));
}
