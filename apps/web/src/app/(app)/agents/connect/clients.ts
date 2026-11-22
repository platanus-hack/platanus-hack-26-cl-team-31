import { LIFECYCLE_EVENT, RESULT_EVENT, RESULT_ROUTING_INSTRUCTION } from "@team-31/protocol";

export const clients = {
  dot: {
    name: "Dot",
    description: "Conecta Sideband como plugin de ChatGPT y activa los eventos MCP.",
    wakeKind: "mcp_events",
    trustLocation: "las instrucciones personalizadas del Dot",
    wakeInstruction: `Suscríbete a ${LIFECYCLE_EVENT}. Para ${RESULT_EVENT}: ${RESULT_ROUTING_INSTRUCTION} Para una solicitud nueva usa sideband_inbox.`,
  },
  grokbot: {
    name: "Grok Bot",
    description: "Conecta Sideband por HTTPS y recibe avisos en una rutina.",
    wakeKind: "grokbot_routine",
    trustLocation: "las instrucciones de la rutina de Grok Bot",
    wakeInstruction: `Crea una rutina con disparador por webhook. Para ${RESULT_EVENT}: ${RESULT_ROUTING_INSTRUCTION} Para una solicitud nueva, consulta sideband_inbox y responde con sideband_reply según el bloque de confianza. Para la prueba de conexión responde con no_data.`,
  },
  openclaw: {
    name: "OpenClaw",
    description: "Conecta tu gateway y recibe avisos en el agente main.",
    wakeKind: "openclaw_hooks",
    trustLocation: "el archivo AGENTS.md de tu agente",
    wakeInstruction: undefined,
  },
} as const;

export type ClientKind = keyof typeof clients;
export type ManualWakeKind = Exclude<ClientKind, "dot">;
