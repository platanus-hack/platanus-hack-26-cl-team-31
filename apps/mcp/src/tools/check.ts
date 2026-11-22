import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentPort } from "@team-31/broker-client";
import { agentScopes, type Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

export function registerCheck(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_check", {
    description: "Consulta el estado o la respuesta final de una solicitud que enviaste usando su requestId. En una rutina de cierre, úsala solo después de verificar el chat privado de origen guardado para ese ID.",
    annotations: { readOnlyHint: true },
    inputSchema: { requestId: routes.agentStatus.params.shape.id },
  }, ({ requestId }) => runTool(telemetry, principal, { tool: "sideband_check", scope: agentScopes.status, requestId },
    () => agent.status(principal, requestId)));
  server.registerTool("sideband_pending", {
    description: "Lista las solicitudes que esperan una decisión de tu titular, como un pedido de acceso a su bóveda. Cuéntaselas: solo tu titular decide, desde Inicio. Tú no puedes conceder ni rechazar.",
    annotations: { readOnlyHint: true },
    outputSchema: routes.agentPending.response,
  }, () => runTool(telemetry, principal, { tool: "sideband_pending", scope: agentScopes.pending },
    async () => ({ items: await agent.pending(principal) })));
  server.registerTool("sideband_activity", {
    description: "Lista las solicitudes recientes de tu titular, enviadas y recibidas: con quién, qué tool, estado, resultado final y fechas. No trae el contenido de preguntas ni respuestas; para la respuesta de una enviada usa sideband_check con su requestId.",
    annotations: { readOnlyHint: true },
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Cuántas solicitudes traer. Por defecto 30.") },
    outputSchema: routes.agentActivity.response,
  }, ({ limit }) => runTool(telemetry, principal, { tool: "sideband_activity", scope: agentScopes.activity },
    async () => ({ items: await agent.activity(principal, { limit }) })));
}
