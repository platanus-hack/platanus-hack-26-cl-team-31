import type { FlowActor, FlowOwner } from "./model.js";

export interface DirectoryUser {
  userId: string;
  address?: string | null;
  displayName?: string | null;
}

export interface DirectoryAgent {
  agentId: string;
  userId?: string | null;
  label?: string | null;
  /** WakeKind del agente (mcp_events, openclaw_hooks…) o un canal (whatsapp). */
  kind?: string | null;
  /** Conexión revocada: no entra en la foto inicial de la red. */
  revokedAt?: string | null;
}

/** Lo que el admin expone de una solicitud (RequestSummary): direcciones e ids, sin contenido. */
export interface DirectoryRequest {
  id: string;
  fromAddress: string;
  toAddress: string;
  targetAgentId?: string | null;
  answeredByAgentId?: string | null;
}

export interface FlowDirectory {
  add(entries: { users?: DirectoryUser[]; agents?: DirectoryAgent[]; requests?: DirectoryRequest[] }): void;
  user(userId: string): DirectoryUser | undefined;
  address(address: string): DirectoryUser | undefined;
  agent(agentId: string): DirectoryAgent | undefined;
  request(requestId: string): DirectoryRequest | undefined;
  /** Todo lo conocido, en orden de alta (para la foto inicial de la red). */
  list(): { users: DirectoryUser[]; agents: DirectoryAgent[] };
}

export function createFlowDirectory(initial?: Parameters<FlowDirectory["add"]>[0]): FlowDirectory {
  const users = new Map<string, DirectoryUser>();
  const addresses = new Map<string, DirectoryUser>();
  const agents = new Map<string, DirectoryAgent>();
  const requests = new Map<string, DirectoryRequest>();
  const directory: FlowDirectory = {
    add(entries) {
      for (const user of entries.users ?? []) {
        users.set(user.userId, user);
        if (user.address) addresses.set(user.address, user);
      }
      for (const agent of entries.agents ?? []) agents.set(agent.agentId, agent);
      for (const request of entries.requests ?? []) requests.set(request.id, request);
    },
    user: (id) => users.get(id),
    address: (address) => addresses.get(address),
    agent: (id) => agents.get(id),
    request: (id) => requests.get(id),
    list: () => ({ users: [...users.values()], agents: [...agents.values()] }),
  };
  if (initial) directory.add(initial);
  return directory;
}

const channelLabels: Record<string, string> = {
  mcp_events: "MCP",
  openclaw_hooks: "OpenClaw",
  grokbot_routine: "Grok Bot",
  standard_webhook: "Webhook",
  whatsapp: "WhatsApp",
  none: "Agente",
};

export const channelLabel = (kind?: string | null) => (kind ? (channelLabels[kind] ?? kind) : undefined);

// Prefijos de las cuentas de prueba y demo: «demo-ana@…» se muestra como «Ana».
const testPrefixes = /^(demo|test|e2e|fixture|seed)[-_.]/i;

/** Nombre visible de un titular: su nombre o, si no tiene, la parte local de su dirección legible. */
export function ownerLabel(address: string | null | undefined, displayName?: string | null): string {
  const name = displayName?.trim();
  if (name) return name;
  if (!address) return "Sin identificar";
  const local = address.split("@")[0] ?? address;
  const words = local.replace(testPrefixes, "").split(/[-_.]+/).filter(Boolean);
  if (words.length === 0) return local;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

const short = (id: string) => (id.length > 10 ? `${id.slice(0, 8)}…` : id);

export function placeholder(owner: FlowOwner): FlowActor {
  return { id: `agent@${owner.key}`, role: "agent", label: "Agente", owner, placeholder: true };
}
export const human = (owner: FlowOwner): FlowActor => ({ id: `owner@${owner.key}`, role: "owner", label: "Titular", owner });

export function createActorResolver(directory: FlowDirectory) {
  const unknownOwner: FlowOwner = { key: "unknown", label: "Sin identificar" };
  const unknownUsers = new Set<string>();
  const unknownAgents = new Set<string>();

  const ownerOfAddress = (address: string): FlowOwner => {
    const user = directory.address(address);
    return { key: address, label: ownerLabel(address, user?.displayName) };
  };
  const ownerOfUser = (userId?: string | null): FlowOwner => {
    if (userId == null) return unknownOwner;
    const user = directory.user(userId);
    if (!user) unknownUsers.add(userId);
    if (user?.address) return { key: user.address, label: ownerLabel(user.address, user.displayName) };
    return { key: `user:${userId}`, label: user?.displayName || short(userId) };
  };

  const agentActor = (agentId: string, fallback: FlowOwner): FlowActor => {
    const agent = directory.agent(agentId);
    if (!agent) unknownAgents.add(agentId);
    const owner = agent?.userId ? ownerOfUser(agent.userId) : fallback;
    const channel = channelLabel(agent?.kind);
    return { id: `agent:${agentId}`, role: "agent", label: agent?.label || channel || "Agente", owner, ...(channel ? { channel } : {}) };
  };
  const whatsappActor = (userId: string): FlowActor => {
    const owner = ownerOfUser(userId);
    const linked = directory.list().agents.find((a) => a.userId === userId && a.kind === "whatsapp" && !a.revokedAt);
    return linked ? agentActor(linked.agentId, owner) : { id: `whatsapp@${owner.key}`, role: "agent", label: "WhatsApp", owner, channel: "WhatsApp" };
  };

  function* snapshotActors(): IterableIterator<FlowActor> {
    const { users, agents } = directory.list();
    const agentsByUser = new Map<string, DirectoryAgent[]>();
    for (const agent of agents) {
      if (agent.userId == null) continue;
      const group = agentsByUser.get(agent.userId);
      if (group) group.push(agent);
      else agentsByUser.set(agent.userId, [agent]);
    }
    for (const user of users) {
      const owner = ownerOfUser(user.userId);
      const own = agentsByUser.get(user.userId);
      // Un titular con agentes revocados ya salió de la red. Solo se dibuja
      // un agente provisional si el titular tiene dirección y nunca tuvo agentes.
      if (own) {
        for (const agent of own) {
          if (!agent.revokedAt) yield agentActor(agent.agentId, owner);
        }
      } else if (user.address) {
        yield placeholder(owner);
      }
    }
  }

  return {
    ownerOfAddress,
    ownerOfUser,
    agentActor,
    whatsappActor,
    snapshotActors,
    takeUnknown() {
      const result = {
        users: [...unknownUsers].filter((id) => !directory.user(id)),
        agents: [...unknownAgents].filter((id) => !directory.agent(id)),
      };
      unknownUsers.clear();
      unknownAgents.clear();
      return result;
    },
  };
}
