import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker-client";
import { agentScopes, invalidInputMessage, ReplyArguments, ReplyInput, ReplyReceipt, ToolResultSchemas, type Principal } from "@team-31/protocol";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

// Un solo sideband_reply responde a todas las tools, así que el esquema publica la unión de sus
// resultados en vez de un unknown que no dice nada. El ejemplo va en la descripción porque el
// anyOf no indica cuál rama corresponde a la solicitud que se está respondiendo: eso lo dice
// allowedFields de la bandeja. El filtro del broker sigue siendo quien decide qué viaja.
const result = z.union(Object.values(ToolResultSchemas)).describe(
  "Objeto JSON cuyas claves son exactamente las de allowedFields de la solicitud en tu bandeja. "
  + "Nunca texto suelto ni el objeto serializado como string. "
  + 'Ejemplos: allowedFields ["answer"] → {"answer": "..."}; ["matches"] → {"matches": true}; '
  + '["available","freeSlots"] → {"available": true, "freeSlots": ["09:00-10:00"]}; ["accepted"] → {"accepted": true}.',
);

// share sólo tiene sentido al aceptar una invitación connect, y el broker rechaza la respuesta
// que lo trae en cualquier otro caso. El esquema no puede condicionarlo —la tool de la solicitud
// no es un argumento de sideband_reply—, así que lo dice la descripción.
const share = ReplyArguments.shape.share.describe(
  "Solo al aceptar una invitación connect: las categorías que tu titular le comparte al contacto. "
  + "Omítelo —ni siquiera como lista vacía— en cualquier otra respuesta; el broker la rechaza.",
);

const inputSchema = ReplyArguments.extend({ share, result: result.optional() });

export function registerReply(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_reply", {
    description: "Responde una solicitud de tu bandeja con requestId y nonce. Usa answered con result como objeto JSON de los campos permitidos (allowedFields), no_data si no tienes el dato, needs_owner si tu dueño debe decidir o declined si prefieres no compartir. No uses needs_owner cuando sí tienes la respuesta: revisa la forma de result y vuelve a intentar.",
    inputSchema,
    outputSchema: ReplyReceipt,
  }, (input) => runTool(telemetry, principal, { tool: "sideband_reply", scope: agentScopes.reply, requestId: input.requestId }, () => {
    const parsed = ReplyInput.safeParse(input);
    // El motivo nombra el campo del propio payload, nunca su valor: sin eso el agente adivina.
    if (!parsed.success) {
      throw new BrokerError("invalid_input", invalidInputMessage("La respuesta no cumple el formato requerido.", parsed.error));
    }
    return agent.reply(principal, parsed.data);
  }));
}
