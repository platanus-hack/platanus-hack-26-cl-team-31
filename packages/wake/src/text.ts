export function WAKE_INSTRUCTION(requestId: string): string {
  return `Tienes una solicitud nueva en Sideband (${requestId}). Usa sideband_inbox para leerla y respóndela con sideband_reply usando su requestId y nonce. Siempre debes responder: si no tienes la información usa outcome "no_data", si necesitas que tu dueño decida usa "needs_owner" y si prefieres no compartir usa "declined". Comparte solo los campos permitidos.`;
}
