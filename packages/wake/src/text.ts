import { RESULT_EVENT, RESULT_ROUTING_INSTRUCTION, type WakeNotice } from "@team-31/protocol";

export function WAKE_INSTRUCTION({ requestId, event }: WakeNotice): string {
  if (event === RESULT_EVENT) return `Terminó tu solicitud de Sideband (${requestId}). ${RESULT_ROUTING_INSTRUCTION}`;
  return `Tienes una solicitud nueva en Sideband (${requestId}). Usa sideband_inbox para leerla y respóndela con sideband_reply usando su requestId y nonce. Siempre debes responder: si no tienes la información usa outcome "no_data", si necesitas que tu dueño decida usa "needs_owner" y si prefieres no compartir usa "declined". Comparte solo los campos permitidos.`;
}
