import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerError, type AgentPort } from "@team-31/broker-client";
import { agentScopes, invalidInputMessage, ReplyArguments, ReplyInput, ReplyReceipt, ToolResultSchemas, type Principal } from "@team-31/protocol";
import { z } from "zod";
import { runTool, type ToolTelemetry } from "./result.js";

// Un solo sideband_reply responde a todas las tools, así que el esquema publica la unión de sus
// resultados en vez de un unknown que no dice nada. El ejemplo va en la descripción porque el
// anyOf no indica cuál rama corresponde a la solicitud que se está respondiendo: eso lo dice
// allowedFields de la bandeja. El filtro del broker sigue siendo quien decide qué viaja.
// El error de la unión es lo único que el agente ve cuando se equivoca de forma, y el SDK lo
// publica como «<mensaje> at result». Un codex real leyó tres veces «Invalid input at result» y
// siguió mandando el objeto serializado como string: el mensaje tiene que nombrar la forma.
// Conserva las claves adicionales para que el broker las filtre y las enumere en droppedFields.
// Algunos clientes serializan un resultado ausente como null o {}. ReplyInput exige uno para answered.
const emptyResult = z.strictObject({}).nullable().transform(() => undefined);
const result = z.union([...Object.values(ToolResultSchemas).map((schema) => schema.loose()), emptyResult], {
  error: 'result debe ser un objeto JSON con los campos de allowedFields —{"answer": "..."}—, no texto ni ese objeto serializado como string',
}).describe(
  "Para no_data, declined o needs_owner puedes omitir result, enviar null o enviar {}. "
  + "Para answered, envía un objeto JSON con los campos de allowedFields de la solicitud en tu bandeja. "
  + "Nunca texto suelto ni el objeto serializado como string. "
  + 'Ejemplos: allowedFields ["answer"] → {"answer": "..."}; ["matches"] → {"matches": true}; '
  + '["available","freeSlots"] → {"available": true, "freeSlots": ["09:00-10:00"]}; ["accepted"] → {"accepted": true}.',
);

// share sólo tiene sentido al aceptar una invitación connect: son los grants que tu titular le da
// a quien invitó. El esquema no puede condicionarlo —la tool de la solicitud no es un argumento de
// sideband_reply—, así que lo dice la descripción. Una lista vacía no otorga nada y el broker la
// ignora fuera de connect; una con categorías sí se rechaza.
const share = ReplyArguments.shape.share.describe(
  "Solo al aceptar una invitación connect: las categorías que tu titular le comparte al contacto. "
  + "En cualquier otra respuesta omítelo; una lista vacía se ignora y una con categorías se rechaza. "
  + "Al aceptar un connect sin compartir nada, envíalo vacío: ahí [] sí significa aceptar con cero categorías.",
);

const inputSchema = ReplyArguments.extend({ share, result: result.optional() }).meta({
  if: { properties: { outcome: { const: "answered" } } },
  then: { required: ["result"], properties: { result: { type: "object", minProperties: 1 } } },
});

export function registerReply(server: McpServer, principal: Principal, agent: AgentPort, telemetry: ToolTelemetry) {
  server.registerTool("sideband_reply", {
    description: "Responde una solicitud de tu bandeja con requestId y nonce. Usa answered con result como objeto JSON de los campos permitidos (allowedFields), no_data si no tienes el dato, needs_owner si tu dueño debe decidir o declined si prefieres no compartir. needs_owner deriva la decisión fuera del chat: no lo uses para esperar el siguiente turno ni cuando sí tienes la respuesta —revisa la forma de result y vuelve a intentar.",
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
