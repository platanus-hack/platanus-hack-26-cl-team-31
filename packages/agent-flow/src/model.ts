// Modelo normalizado del flujo entre agentes. Lo producen el mapeo de telemetría
// (telemetry.ts) y el escenario de demostración (scenario.ts); lo consume el renderer.
//
// Solo metadatos seguros: herramienta, categoría, decisión, regla, campos, códigos,
// latencia e ids. Nunca args, result, tokens, nonces ni texto libre de terceros.

/** Id del nodo central: el broker de Sideband. */
export const BROKER = "broker";

export type FlowStatus =
  | "pending"
  | "ok"
  | "allowed"
  | "denied"
  | "blocked"
  | "sanitized"
  | "escalated"
  | "delivered"
  | "expired"
  | "failed";

export type FlowStep =
  | "ask" // el agente que pregunta llama al broker (sideband_ask)
  | "policy" // el broker evalúa la política (grant, círculo, categoría)
  | "request" // el broker crea y firma la solicitud
  | "wake" // el broker avisa al agente del destinatario
  | "inbox" // el agente lee su bandeja
  | "reply" // el agente responde a través del broker
  | "sanitized" // el broker sanea la respuesta (descarta campos o marca hallazgos)
  | "reply_blocked" // el broker rechaza la respuesta (leak_blocked, expirada…)
  | "escalated" // la solicitud espera la decisión del titular
  | "owner_decided" // el titular decide
  | "delivered" // el resultado final llega a quien preguntó
  | "check" // quien preguntó consulta el estado
  | "tool" // otra tool del MCP
  | "joined" // un agente entra a la red (conexión verificada, vínculo, primera llamada)
  | "left"; // un agente sale de la red (vínculo cortado, conexión revocada)

export type ActorRole = "agent" | "owner";

export interface FlowOwner {
  /** Clave estable del titular (dirección Sideband o id). */
  key: string;
  label: string;
}

export interface FlowActor {
  id: string;
  clientId?: string;
  /** agent: asistente conectado. owner: el titular humano (aparece al escalar). */
  role: ActorRole;
  label: string;
  owner: FlowOwner;
  /** Canal o tipo de conexión: MCP, OpenClaw… */
  channel?: string;
  /** El agente concreto aún no se conoce: se fusiona con el primero que aparezca del mismo titular. */
  placeholder?: boolean;
}

export type FlowEndpoint = FlowActor | typeof BROKER;

export interface FlowMeta {
  tool?: string;
  category?: string;
  decision?: string;
  rule?: string;
  outcome?: string;
  fieldsDropped?: string[];
  flags?: string[];
  code?: string;
  attempt?: number;
  httpStatus?: number;
  by?: string;
  escalated?: boolean;
  latencyMs?: number;
  service?: string;
  /** Parte de la foto inicial de la red: se aplica de inmediato, sin animación. */
  snapshot?: boolean;
}

export interface FlowEvent {
  id: string;
  /** Epoch en ms. */
  at: number;
  step: FlowStep;
  status: FlowStatus;
  from: FlowEndpoint;
  to: FlowEndpoint;
  requestId?: string;
  traceId?: string;
  meta: FlowMeta;
}

export const endpointId = (endpoint: FlowEndpoint): string => (endpoint === BROKER ? BROKER : endpoint.id);

/** Estados en los que una solicitud ya terminó. */
export const finalStatuses: ReadonlySet<FlowStatus> = new Set(["delivered", "denied", "expired", "failed"]);
