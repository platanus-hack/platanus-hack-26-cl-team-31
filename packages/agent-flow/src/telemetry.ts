// Único mapeo de la telemetría de Sideband (catálogo de @team-31/telemetry, filas de ops.events
// ya redactadas) al modelo FlowEvent. Lo usan el modo en vivo del admin y el escenario de la landing.
//
// Solo lee atributos de una lista blanca por evento. Cualquier otro atributo se ignora, así que un
// campo nuevo del catálogo nunca llega a la vista sin pasar por aquí.
import { BROKER, type FlowActor, type FlowEvent, type FlowMeta, type FlowOwner, type FlowStatus } from "./model.js";
import { createActorResolver, human, placeholder, type FlowDirectory } from "./directory.js";

export {
  channelLabel,
  createFlowDirectory,
  ownerLabel,
  type DirectoryAgent,
  type DirectoryRequest,
  type DirectoryUser,
  type FlowDirectory,
} from "./directory.js";

type Scalar = string | number | boolean | null;

/** Forma mínima de un evento de ops.events (compatible con TelemetryEvent del admin). */
export interface TelemetryRow {
  id: string;
  at: string | number;
  service: string;
  name: string;
  requestId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  traceId?: string | null;
  durationMs?: number | null;
  status?: string | null;
  attrs: Record<string, Scalar | undefined>;
}

/**
 * Atributos que el mapeo lee de cada evento. El servidor del admin recorta `attrs` a esta lista
 * antes de enviar una fila al navegador (`projectFlowRow`): lo que no está aquí nunca sale.
 */
export const flowAttrKeys: Readonly<Record<string, readonly string[]>> = {
  "broker.policy.evaluated": ["tool", "category", "decision", "rule"],
  "broker.request.created": ["tool", "rule", "targetAgentId"],
  "broker.request.status_changed": ["from", "to", "by"],
  "broker.request.closed": ["outcome", "escalated"],
  "broker.reply.rejected": ["code", "flags"],
  "broker.reply.sanitized": ["flags", "dropped"],
  "broker.owner.decided": ["decision"],
  "wake.attempt": ["attempt", "ok", "httpStatus", "code"],
  "wake.exhausted": ["attempts"],
  "mcp.tool.call": ["tool", "outcome"],
  "coordination.tool.call": ["tool", "outcome"],
  "whatsapp.link": ["action"],
  "broker.agent.connected": ["kind"],
  "broker.agent.revoked": ["by"],
};

/** Eventos del catálogo que se proyectan al flujo. */
export const flowEventNames: ReadonlySet<string> = new Set(Object.keys(flowAttrKeys));

const askTools = new Set(["sideband_ask", "ask_contact"]);
const checkTools = new Set(["sideband_check", "await_contact"]);

// Servicios que reciben avisos (receptores de prueba de web y de la demo): su wake.attempt es el
// acuse del receptor, no el intento del broker, y dibujarlo duplicaría el aviso.
const receiverServices = new Set(["coordination", "web"]);

/**
 * true si la fila produce algún paso. Las tools de coordinación que no pasan por el broker y el
 * acuse de un receptor de avisos no cuentan.
 */
export function isFlowRow(row: Pick<TelemetryRow, "name" | "attrs" | "service">): boolean {
  if (!flowEventNames.has(row.name)) return false;
  if (row.name === "wake.attempt" && receiverServices.has(row.service)) return false;
  if (row.name !== "coordination.tool.call") return true;
  const tool = row.attrs.tool;
  return typeof tool === "string" && (askTools.has(tool) || checkTools.has(tool));
}

/** Copia de la fila con `attrs` recortado a `flowAttrKeys`. La usa el servidor antes de enviarla. */
export function projectFlowRow<R extends TelemetryRow>(row: R): Omit<R, "attrs"> & { attrs: Record<string, Scalar> } {
  const keys = flowAttrKeys[row.name] ?? [];
  const attrs: Record<string, Scalar> = {};
  for (const key of keys) {
    const value = row.attrs[key];
    if (value !== undefined) attrs[key] = value;
  }
  return { ...row, attrs };
}

// Spans: `at` es el final; el paso empezó durationMs antes.
const spans = new Set(["mcp.tool.call", "coordination.tool.call", "wake.attempt"]);

const str = (value: Scalar | undefined) => (typeof value === "string" && value.length > 0 ? value : undefined);
const num = (value: Scalar | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const codes = (value: Scalar | undefined) => str(value)?.split(",").filter(Boolean);

const outcomeStatus: Record<string, FlowStatus> = {
  answered: "delivered",
  no_data: "delivered",
  declined: "denied",
  denied: "denied",
  expired: "expired",
  delivery_failed: "failed",
};
const decisionStatus: Record<string, FlowStatus> = {
  approve_once: "allowed",
  answer: "allowed",
  accept: "allowed",
  deny: "denied",
  decline: "denied",
};

interface RequestContext {
  requesterAgent?: string;
  requesterUser?: string;
  recipientAgent?: string;
  recipientUser?: string;
  asked?: boolean;
  replied?: boolean;
}

export interface TelemetryMapper {
  /** Convierte una fila en 0..n pasos. Con estado: recuerda los agentes de cada solicitud. */
  map(row: TelemetryRow): FlowEvent[];
  /**
   * Foto inicial de la red desde el directorio: un `joined` (snapshot) por agente no revocado y uno
   * provisional por titular con dirección y sin agentes. Va antes de los eventos en vivo.
   */
  snapshot(at: number): FlowEvent[];
  /**
   * Compara el directorio (recién refrescado) con quienes el mapeo cree presentes: `left` por cada
   * agente que ahora figura revocado y `joined` por cada agente nuevo no revocado. Cubre señales
   * perdidas mientras el stream estuvo caído. Idempotente.
   */
  reconcile(at: number): FlowEvent[];
  /** Ids de usuario y agente que aparecieron en filas y no están en el directorio. Se vacía al leerlo. */
  takeUnknown(): { users: string[]; agents: string[] };
}

/** Filas recordadas para descartar duplicados (reconexiones, relecturas del servidor). */
const SEEN_ROWS = 10_000;

export function createTelemetryMapper(directory: FlowDirectory): TelemetryMapper {
  const { ownerOfAddress, ownerOfUser, agentActor, whatsappActor, snapshotActors, takeUnknown } = createActorResolver(directory);
  const contexts = new Map<string, RequestContext>();
  // Ids de fila ya mapeados (orden de alta, acotado): una fila repetida no produce pasos.
  const mappedRows = new Set<string>();
  // Agentes presentes según la foto, las entradas y las salidas (para `reconcile`).
  const present = new Set<string>();
  // Último nombre con el que se dibujó cada agente: si el directorio lo completa después, reconcile lo corrige.
  const drawnLabels = new Map<string, string>();
  const labelKey = (actor: FlowActor) => `${actor.owner.key}|${actor.owner.label}|${actor.label}|${actor.channel ?? ""}`;

  // Agentes ya vistos: su primera llamada al MCP cuenta como entrada a la red.
  const seen = new Set<string>();

  function context(requestId: string | undefined): RequestContext {
    if (!requestId) return {};
    let ctx = contexts.get(requestId);
    if (!ctx) {
      ctx = {};
      contexts.set(requestId, ctx);
      // Acota la memoria en sesiones largas del admin.
      if (contexts.size > 2_000) contexts.delete(contexts.keys().next().value as string);
    }
    return ctx;
  }

  function requesterOwner(requestId: string | undefined, ctx: RequestContext): FlowOwner {
    const request = requestId ? directory.request(requestId) : undefined;
    if (request) return ownerOfAddress(request.fromAddress);
    return ownerOfUser(ctx.requesterUser);
  }
  function recipientOwner(requestId: string | undefined, ctx: RequestContext): FlowOwner {
    const request = requestId ? directory.request(requestId) : undefined;
    if (request) return ownerOfAddress(request.toAddress);
    return ownerOfUser(ctx.recipientUser);
  }
  function requester(requestId: string | undefined, ctx: RequestContext): FlowActor {
    const owner = requesterOwner(requestId, ctx);
    return ctx.requesterAgent ? agentActor(ctx.requesterAgent, owner) : placeholder(owner);
  }
  function recipient(requestId: string | undefined, ctx: RequestContext): FlowActor {
    const owner = recipientOwner(requestId, ctx);
    const request = requestId ? directory.request(requestId) : undefined;
    const agentId = ctx.recipientAgent ?? request?.answeredByAgentId ?? request?.targetAgentId ?? undefined;
    return agentId ? agentActor(agentId, owner) : placeholder(owner);
  }

  return {
    map(row) {
      if (mappedRows.has(row.id) || !isFlowRow(row)) return [];
      mappedRows.add(row.id);
      if (mappedRows.size > SEEN_ROWS) mappedRows.delete(mappedRows.values().next().value as string);
      const { attrs } = row;
      const requestId = row.requestId ?? undefined;
      const ctx = context(requestId);
      const end = typeof row.at === "number" ? row.at : Date.parse(row.at);
      const duration = row.durationMs ?? undefined;
      const at = spans.has(row.name) && duration ? end - duration : end;
      const out: FlowEvent[] = [];
      const push = (event: Omit<FlowEvent, "id" | "at" | "requestId" | "traceId">) => {
        for (const end of [event.from, event.to]) {
          if (end === BROKER || end.role !== "agent" || end.placeholder) continue;
          seen.add(end.id);
          drawnLabels.set(end.id, labelKey(end));
          // Participar cuenta como presencia, salvo el propio paso de salida.
          if (event.step !== "left" && end.id.startsWith("agent:")) present.add(end.id);
        }
        out.push({
          id: out.length === 0 ? row.id : `${row.id}:${out.length}`,
          at: at + out.length, // conserva el orden dentro de una misma fila
          ...(requestId ? { requestId } : {}),
          ...(row.traceId ? { traceId: row.traceId } : {}),
          ...event,
          meta: { service: row.service, ...(duration !== undefined ? { latencyMs: Math.round(duration) } : {}), ...event.meta },
        });
      };

      switch (row.name) {
        case "broker.policy.evaluated": {
          if (row.userId) ctx.requesterUser = row.userId;
          if (row.agentId) ctx.requesterAgent = row.agentId;
          const tool = str(attrs.tool);
          const category = str(attrs.category);
          const decision = str(attrs.decision);
          if (!ctx.asked) {
            ctx.asked = true;
            push({ step: "ask", status: "pending", from: requester(requestId, ctx), to: BROKER, meta: { tool, category } });
          }
          const status: FlowStatus = decision === "allow" ? "allowed" : decision === "ask_owner" ? "escalated" : "denied";
          push({ step: "policy", status, from: BROKER, to: BROKER, meta: { tool, category, decision, rule: str(attrs.rule) } });
          break;
        }
        case "broker.request.created": {
          if (!ctx.requesterUser && row.userId) ctx.requesterUser = row.userId;
          if (row.agentId) ctx.requesterAgent = row.agentId;
          const target = str(attrs.targetAgentId);
          if (target) ctx.recipientAgent = target;
          push({ step: "request", status: "ok", from: BROKER, to: BROKER, meta: { tool: str(attrs.tool), rule: str(attrs.rule) } });
          break;
        }
        case "coordination.tool.call":
        case "mcp.tool.call": {
          const tool = str(attrs.tool) ?? "tool";
          const outcome = str(attrs.outcome);
          const failed: FlowStatus | undefined = outcome === "denied" ? "denied" : outcome === "error" ? "failed" : undefined;
          if (askTools.has(tool)) {
            if (row.userId) ctx.requesterUser ??= row.userId;
            if (row.agentId) ctx.requesterAgent ??= row.agentId;
            // El span termina después de los eventos del broker: si la política ya dibujó la pregunta, no se repite.
            if (ctx.asked) break;
            ctx.asked = Boolean(requestId);
            push({ step: "ask", status: failed ?? "pending", from: requester(requestId, ctx), to: BROKER, meta: { tool } });
            break;
          }
          const owner = ownerOfUser(row.userId || undefined);
          const self = row.agentId ? agentActor(row.agentId, owner) : placeholder(owner);
          if (row.agentId && !seen.has(self.id)) {
            push({ step: "joined", status: "ok", from: self, to: self, meta: {} });
          }
          if (tool === "sideband_reply") {
            if (row.agentId) ctx.recipientAgent ??= row.agentId;
            if (ctx.replied) break;
            push({ step: "reply", status: failed ?? "ok", from: self, to: BROKER, meta: { tool } });
            break;
          }
          const step = checkTools.has(tool) ? "check" : tool === "sideband_inbox" ? "inbox" : "tool";
          push({ step, status: failed ?? "ok", from: self, to: BROKER, meta: { tool } });
          break;
        }
        case "broker.agent.connected":
        case "broker.agent.revoked": {
          if (!row.agentId || !row.userId) break;
          const actor = agentActor(row.agentId, ownerOfUser(row.userId));
          const joined = row.name === "broker.agent.connected";
          if (!joined) present.delete(actor.id);
          push({ step: joined ? "joined" : "left", status: joined ? "ok" : "expired", from: actor, to: actor, meta: joined ? {} : { by: str(attrs.by) } });
          break;
        }
        case "whatsapp.link": {
          const action = str(attrs.action);
          if (!row.userId || (action !== "confirmed" && action !== "unlinked")) break;
          const actor = whatsappActor(row.userId);
          push({ step: action === "confirmed" ? "joined" : "left", status: action === "confirmed" ? "ok" : "expired", from: actor, to: actor, meta: {} });
          break;
        }
        case "wake.attempt": {
          if (row.agentId) ctx.recipientAgent = row.agentId;
          if (row.userId) ctx.recipientUser = row.userId;
          const ok = attrs.ok === true;
          push({
            step: "wake",
            status: ok ? "ok" : "failed",
            from: BROKER,
            to: recipient(requestId, ctx),
            meta: { attempt: num(attrs.attempt), httpStatus: num(attrs.httpStatus), code: str(attrs.code) },
          });
          break;
        }
        case "wake.exhausted": {
          if (row.agentId) ctx.recipientAgent = row.agentId;
          push({ step: "wake", status: "failed", from: BROKER, to: recipient(requestId, ctx), meta: { attempt: num(attrs.attempts), code: "exhausted" } });
          break;
        }
        case "broker.request.status_changed": {
          const from = str(attrs.from);
          const to = str(attrs.to);
          if (attrs.by !== "agent" || from !== "awaiting_agent") break;
          if (!ctx.replied) {
            ctx.replied = true;
            push({ step: "reply", status: "ok", from: recipient(requestId, ctx), to: BROKER, meta: { outcome: to, by: "agent" } });
          }
          if (to === "awaiting_owner") {
            push({ step: "escalated", status: "escalated", from: BROKER, to: human(recipientOwner(requestId, ctx)), meta: { outcome: to } });
          }
          break;
        }
        case "broker.reply.rejected": {
          const code = str(attrs.code);
          const status: FlowStatus = code === "leak_blocked" ? "blocked" : code === "expired" ? "expired" : "failed";
          push({ step: "reply_blocked", status, from: recipient(requestId, ctx), to: BROKER, meta: { code, flags: codes(attrs.flags) } });
          break;
        }
        case "broker.reply.sanitized": {
          push({ step: "sanitized", status: "sanitized", from: BROKER, to: BROKER, meta: { flags: codes(attrs.flags), fieldsDropped: codes(attrs.dropped) } });
          break;
        }
        case "broker.owner.decided": {
          if (row.userId) ctx.recipientUser ??= row.userId;
          const decision = str(attrs.decision);
          push({
            step: "owner_decided",
            status: (decision && decisionStatus[decision]) || "ok",
            from: human(recipientOwner(requestId, ctx)),
            to: BROKER,
            meta: { decision },
          });
          break;
        }
        case "broker.request.closed": {
          const outcome = str(attrs.outcome);
          push({
            step: "delivered",
            status: (outcome && outcomeStatus[outcome]) || "ok",
            from: BROKER,
            to: requester(requestId, ctx),
            meta: { outcome, escalated: typeof attrs.escalated === "boolean" ? attrs.escalated : undefined },
          });
          break;
        }
        default:
          break;
      }
      return out.map(stripUndefined);
    },
    snapshot(at) {
      const out: FlowEvent[] = [];
      for (const actor of snapshotActors()) {
        seen.add(actor.id);
        drawnLabels.set(actor.id, labelKey(actor));
        if (!actor.placeholder && actor.id.startsWith("agent:")) present.add(actor.id);
        out.push({ id: `snapshot:${actor.id}`, at, step: "joined", status: "ok", from: actor, to: actor, meta: { snapshot: true } });
      }
      return out;
    },
    reconcile(at) {
      const out: FlowEvent[] = [];
      const { agents } = directory.list();
      for (const agent of agents) {
        const id = `agent:${agent.agentId}`;
        const owner = ownerOfUser(agent.userId || undefined);
        if (agent.revokedAt && present.has(id)) {
          present.delete(id);
          const actor = agentActor(agent.agentId, owner);
          out.push({ id: `reconcile:left:${id}:${at}`, at, step: "left", status: "expired", from: actor, to: actor, meta: {} });
        } else if (!agent.revokedAt && !present.has(id) && !seen.has(id)) {
          seen.add(id);
          present.add(id);
          const actor = agentActor(agent.agentId, owner);
          drawnLabels.set(id, labelKey(actor));
          out.push({ id: `reconcile:joined:${id}:${at}`, at, step: "joined", status: "ok", from: actor, to: actor, meta: {} });
        } else if (!agent.revokedAt && drawnLabels.has(id)) {
          // Ya dibujado con un nombre provisional (p. ej. llegó antes que su titular al directorio):
          // una entrada sin animación ni línea de tiempo actualiza la tarjeta.
          const actor = agentActor(agent.agentId, owner);
          if (drawnLabels.get(id) === labelKey(actor)) continue;
          drawnLabels.set(id, labelKey(actor));
          out.push({ id: `reconcile:label:${id}:${at}`, at, step: "joined", status: "ok", from: actor, to: actor, meta: { snapshot: true } });
        }
      }
      return out;
    },
    takeUnknown,
  };
}

function stripUndefined(event: FlowEvent): FlowEvent {
  const meta = Object.fromEntries(Object.entries(event.meta).filter(([, value]) => value !== undefined)) as FlowMeta;
  return { ...event, meta };
}
