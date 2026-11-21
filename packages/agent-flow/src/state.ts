// Estado del grafo: actores, titulares, solicitudes y bitácora de pasos aplicados.
// reduceFlow es puro: el mismo orden de eventos produce siempre el mismo estado.
import { BROKER, endpointId, finalStatuses, type FlowActor, type FlowEndpoint, type FlowEvent, type FlowOwner, type FlowStatus } from "./model.js";

export type Activity = "idle" | "waiting" | "thinking" | "deciding";

export interface ActorEntry {
  actor: FlowActor;
  /** Orden de aparición: define la posición en el layout. */
  order: number;
  lastStatus?: FlowStatus;
  /** Presencia en la red. Sin valor: apareció por un paso y se considera presente. */
  presence?: "present" | "left";
  /** Reloj de reproducción al unirse o salir (anima la entrada y la salida). */
  joinedT?: number;
  leftT?: number;
  /** `at` del último evento de presencia aplicado: uno más viejo no lo revierte. */
  presenceAt?: number;
}

export interface RequestTrack {
  id: string;
  requester?: string;
  recipient?: string;
  human?: string;
  phase: "asked" | "woken" | "replied" | "escalated" | "closed";
  status: FlowStatus;
  tool?: string;
  category?: string;
  events: string[];
}

export interface AppliedEvent {
  event: FlowEvent;
  /** Tiempo del reloj de reproducción en que se aplicó (ms). */
  t: number;
}

export interface FlowState {
  actors: Map<string, ActorEntry>;
  aliases: Map<string, string>;
  owners: Map<string, { owner: FlowOwner; order: number }>;
  requests: Map<string, RequestTrack>;
  log: AppliedEvent[];
  seq: number;
}

export const LOG_LIMIT = 400;

export function emptyFlowState(): FlowState {
  return { actors: new Map(), aliases: new Map(), owners: new Map(), requests: new Map(), log: [], seq: 0 };
}

/** Sigue los alias (un agente provisional que ya se identificó). */
export function resolveId(state: Pick<FlowState, "aliases">, id: string): string {
  let current = id;
  for (let i = 0; i < 4; i++) {
    const next = state.aliases.get(current);
    if (!next) break;
    current = next;
  }
  return current;
}

function upsertActor(state: FlowState, endpoint: FlowEndpoint): string {
  if (endpoint === BROKER) return BROKER;
  const ownerKey = endpoint.owner.key;
  if (!state.owners.has(ownerKey)) state.owners.set(ownerKey, { owner: endpoint.owner, order: state.owners.size });
  else if (state.owners.get(ownerKey)!.owner.label !== endpoint.owner.label && endpoint.owner.label !== ownerKey) {
    state.owners.set(ownerKey, { ...state.owners.get(ownerKey)!, owner: endpoint.owner });
  }

  const id = resolveId(state, endpoint.id);
  if (state.actors.has(id)) {
    const entry = state.actors.get(id)!;
    // Un endpoint concreto trae la etiqueta más reciente (el directorio pudo completarse después).
    if (!endpoint.placeholder && id === endpoint.id) state.actors.set(id, { ...entry, actor: { ...endpoint } });
    return id;
  }

  if (endpoint.role === "agent") {
    const agents = [...state.actors.values()].filter((e) => e.actor.role === "agent" && e.actor.owner.key === ownerKey);
    if (endpoint.placeholder) {
      // Ya conocemos un agente de ese titular: el provisional es ese agente.
      const real = agents.find((e) => !e.actor.placeholder);
      if (real) {
        state.aliases.set(endpoint.id, real.actor.id);
        return real.actor.id;
      }
    } else {
      // Llega el agente concreto: reemplaza al provisional y hereda su posición.
      const provisional = agents.find((e) => e.actor.placeholder);
      if (provisional) {
        state.actors.delete(provisional.actor.id);
        state.aliases.set(provisional.actor.id, endpoint.id);
        state.actors.set(endpoint.id, { actor: { ...endpoint }, order: provisional.order });
        return endpoint.id;
      }
    }
  }
  state.actors.set(endpoint.id, { actor: { ...endpoint }, order: state.seq++ });
  return endpoint.id;
}

/** Aplica un paso. Devuelve un estado nuevo (copias superficiales de los mapas). */
export function reduceFlow(previous: FlowState, event: FlowEvent, t: number): FlowState {
  const state: FlowState = {
    actors: new Map(previous.actors),
    aliases: new Map(previous.aliases),
    owners: new Map(previous.owners),
    requests: new Map(previous.requests),
    log: previous.log.length >= LOG_LIMIT ? previous.log.slice(previous.log.length - LOG_LIMIT + 1) : previous.log.slice(),
    seq: previous.seq,
  };
  if (event.step === "joined" || event.step === "left") return reducePresence(state, event, t);
  const fromId = upsertActor(state, event.from);
  const toId = upsertActor(state, event.to);
  for (const id of [fromId, toId]) {
    const entry = state.actors.get(id);
    // Participar en un paso posterior a su salida lo devuelve a la red.
    const back = entry?.presence === "left" && (entry.presenceAt ?? 0) <= event.at;
    if (entry) state.actors.set(id, { ...entry, lastStatus: event.status, ...(back ? { presence: "present", joinedT: t, leftT: undefined, presenceAt: event.at } : {}) });
  }

  if (event.requestId) {
    const track: RequestTrack = { ...(state.requests.get(event.requestId) ?? { id: event.requestId, phase: "asked", status: "pending", events: [] }) };
    track.events = [...track.events, event.id];
    if (event.meta.tool && !track.tool) track.tool = event.meta.tool;
    if (event.meta.category && !track.category) track.category = event.meta.category;
    switch (event.step) {
      case "ask":
        track.requester = fromId;
        track.status = event.status;
        break;
      case "policy":
        track.status = event.status;
        break;
      case "wake":
        track.recipient = toId;
        if (event.status === "ok" && track.phase !== "closed") track.phase = "woken";
        break;
      case "reply":
        track.recipient = fromId;
        if (track.phase !== "closed") track.phase = "replied";
        break;
      case "reply_blocked":
        track.recipient = fromId;
        track.status = event.status;
        break;
      case "sanitized":
        track.status = "sanitized";
        break;
      case "escalated":
        track.human = toId;
        track.status = "escalated";
        if (track.phase !== "closed") track.phase = "escalated";
        break;
      case "owner_decided":
        track.human = fromId;
        track.status = event.status;
        if (track.phase !== "closed") track.phase = "replied";
        break;
      case "delivered":
        track.requester = toId;
        track.status = event.status;
        track.phase = "closed";
        break;
      default:
        break;
    }
    state.requests.set(event.requestId, track);
    if (state.requests.size > 500) state.requests.delete(state.requests.keys().next().value as string);
  }

  state.log.push({ event, t });
  return state;
}

/** Entrada y salida de la red: idempotente y tolerante al orden (gana el `at` más reciente). */
function reducePresence(state: FlowState, event: FlowEvent, t: number): FlowState {
  const existed = event.from !== BROKER && state.actors.has(resolveId(state, event.from.id));
  const id = upsertActor(state, event.from);
  const entry = state.actors.get(id);
  if (!entry) return state;
  if (entry.presenceAt !== undefined && event.at < entry.presenceAt) return state;
  const joining = event.step === "joined";
  const changed = joining ? !existed || entry.presence === "left" : entry.presence !== "left";
  if (!changed) {
    state.actors.set(id, { ...entry, presenceAt: event.at });
    return state;
  }
  state.actors.set(
    id,
    joining
      ? { ...entry, presence: "present", joinedT: event.meta.snapshot ? undefined : t, leftT: undefined, presenceAt: event.at }
      : { ...entry, presence: "left", leftT: t, presenceAt: event.at },
  );
  if (!event.meta.snapshot) state.log.push({ event, t });
  return state;
}

/** Qué hace cada actor ahora: espera una respuesta, piensa una respuesta o decide como titular. */
export function activities(state: FlowState): Map<string, Activity> {
  const result = new Map<string, Activity>();
  const rank: Record<Activity, number> = { idle: 0, waiting: 1, thinking: 2, deciding: 3 };
  const set = (id: string | undefined, activity: Activity) => {
    if (!id) return;
    const resolved = resolveId(state, id);
    if (rank[activity] > rank[result.get(resolved) ?? "idle"]) result.set(resolved, activity);
  };
  for (const track of state.requests.values()) {
    if (track.phase === "closed" || finalStatuses.has(track.status)) continue;
    set(track.requester, "waiting");
    if (track.phase === "woken") set(track.recipient, "thinking");
    if (track.phase === "escalated") set(track.human, "deciding");
  }
  return result;
}

export const eventEndpoints = (state: Pick<FlowState, "aliases">, event: FlowEvent) => ({
  fromId: resolveId(state, endpointId(event.from)),
  toId: resolveId(state, endpointId(event.to)),
});

/**
 * Estado tras aplicar los primeros `count` eventos con sus tiempos. Es un fold puro de reduceFlow;
 * con `cache` guarda una foto cada `every` eventos para que buscar en el pasado sea O(every).
 */
export function foldFlow(
  events: readonly FlowEvent[],
  times: readonly number[],
  count: number,
  cache?: Map<number, FlowState>,
  every = 50,
): FlowState {
  let start = 0;
  let state = emptyFlowState();
  if (cache) {
    for (let k = Math.floor(count / every) * every; k > 0; k -= every) {
      const hit = cache.get(k);
      if (hit) {
        start = k;
        state = hit;
        break;
      }
    }
  }
  const end = Math.min(count, events.length, times.length);
  for (let i = start; i < end; i++) {
    state = reduceFlow(state, events[i]!, times[i]!);
    if (cache && (i + 1) % every === 0 && !cache.has(i + 1)) cache.set(i + 1, state);
  }
  return state;
}
