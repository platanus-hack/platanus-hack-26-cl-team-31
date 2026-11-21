import { WAKE_EVENT } from "@team-31/protocol";

export const clients = {
  dot: {
    name: "Dot",
    description: "Conecta Nexo como plugin de ChatGPT y activa los eventos MCP.",
    wakeKind: "mcp_events",
    trustLocation: "las instrucciones personalizadas del Dot",
    wakeInstruction: `Suscríbete al evento ${WAKE_EVENT} de Nexo. Cuando llegue un aviso, consulta nexo_inbox y responde según el bloque de confianza.`,
  },
  grokbot: {
    name: "Grok Bot",
    description: "Conecta Nexo por HTTPS y recibe avisos en una rutina.",
    wakeKind: "grokbot_routine",
    trustLocation: "las instrucciones de la rutina de Grok Bot",
    wakeInstruction: "Crea una rutina de webhook para Nexo. Cuando se dispare, consulta nexo_inbox y responde según el bloque de confianza.",
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
