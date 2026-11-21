import type { SharingRules } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { AgentConnectionRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob } from "./store.js";

type State = {
  users: Map<string, UserRow>;
  rules: Map<string, SharingRules>;
  requests: Map<string, RequestRow>;
  events: RequestEvent[];
  wakes: Map<string, WakeJob>;
  agents: Map<string, AgentConnectionRow>;
};

function agentKey(userId: string, agentId: string): string {
  return JSON.stringify([userId, agentId]);
}

function byCreatedAt(a: RequestRow, b: RequestRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

function transaction(state: State): StoreTx {
  return {
    async getUser(userId) {
      return structuredClone(state.users.get(userId) ?? null);
    },
    async getUserByAddress(address) {
      return structuredClone([...state.users.values()].find((user) => user.address === address) ?? null);
    },
    async createAddress(userId, address) {
      const user = state.users.get(userId);
      if (user?.address || [...state.users.values()].some((entry) => entry.address === address)) {
        throw new BrokerError("conflict", "Esa dirección ya está tomada.");
      }
      state.users.set(userId, { userId, createdAt: new Date(), ...user, address });
    },
    async getRules(userId) {
      return structuredClone(state.rules.get(userId) ?? null);
    },
    async putRules(userId, rules) {
      if (!state.users.has(userId)) state.users.set(userId, { userId, createdAt: new Date() });
      state.rules.set(userId, structuredClone(rules));
    },
    async insertRequest(row) {
      if (state.requests.has(row.id)) throw new BrokerError("conflict", "La solicitud ya existe.");
      state.requests.set(row.id, structuredClone(row));
    },
    async getRequest(id, participant) {
      const row = state.requests.get(id);
      if (!row) return null;
      if (participant && "fromUserId" in participant && row.fromUserId !== participant.fromUserId) return null;
      if (participant && "toUserId" in participant && row.toUserId !== participant.toUserId) return null;
      return structuredClone(row);
    },
    async updateRequest(id, patch, expectedVersion) {
      const row = state.requests.get(id);
      if (!row || row.version !== expectedVersion) return false;
      state.requests.set(id, structuredClone({ ...row, ...patch, id, version: row.version + 1 }));
      return true;
    },
    async listInbox(address) {
      return structuredClone([...state.requests.values()]
        .filter((row) => row.toAddress === address && row.status === "awaiting_agent").sort(byCreatedAt));
    },
    async listOwnerPending(address) {
      return structuredClone([...state.requests.values()]
        .filter((row) => row.toAddress === address && row.status === "awaiting_owner").sort(byCreatedAt));
    },
    async listActivity(address, limit) {
      return structuredClone([...state.requests.values()]
        .filter((row) => row.toAddress === address || row.fromAddress === address)
        .sort((a, b) => byCreatedAt(b, a)).slice(0, limit));
    },
    async listDueForExpiry(now, limit) {
      return structuredClone([...state.requests.values()]
        .filter((row) => (row.status === "awaiting_owner" || row.status === "awaiting_agent") && row.expiresAt <= now)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit));
    },
    async appendEvent(event) {
      state.events.push(structuredClone(event));
    },
    async listEvents(requestIds) {
      const ids = new Set(requestIds);
      return structuredClone(state.events.filter((event) => ids.has(event.requestId)));
    },
    async enqueueWake(job) {
      if (state.wakes.has(job.id)) throw new BrokerError("conflict", "El aviso ya existe.");
      state.wakes.set(job.id, structuredClone(job));
    },
    async claimDueWakes(now, limit) {
      const jobs = [...state.wakes.values()].filter((job) => job.state === "queued" && job.runAt <= now)
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit);
      for (const job of jobs) job.state = "running";
      return structuredClone(jobs);
    },
    async completeWake(id, result, nextRunAt) {
      const job = state.wakes.get(id);
      if (!job || job.state !== "running") return;
      job.lastResult = structuredClone(result);
      job.state = nextRunAt ? "queued" : "done";
      if (nextRunAt) {
        job.attempt++;
        job.runAt = structuredClone(nextRunAt);
      }
    },
    async ensureAgentConnection(row) {
      const key = agentKey(row.userId, row.agentId);
      if (!state.agents.has(key)) await this.upsertAgentConnection(row);
      return structuredClone(state.agents.get(key)!);
    },
    async upsertAgentConnection(row) {
      if (!state.users.has(row.userId)) {
        state.users.set(row.userId, { userId: row.userId, createdAt: structuredClone(row.createdAt) });
      }
      state.agents.set(agentKey(row.userId, row.agentId), structuredClone(row));
    },
    async listAgentConnections(userId) {
      return structuredClone([...state.agents.values()].filter((row) => row.userId === userId));
    },
    async getAgentConnection(userId, agentId) {
      return structuredClone(state.agents.get(agentKey(userId, agentId)) ?? null);
    },
  };
}

export function createMemoryStore(): Store {
  let state: State = {
    users: new Map(), rules: new Map(), requests: new Map(),
    events: [], wakes: new Map(), agents: new Map(),
  };
  let previous = Promise.resolve();

  return {
    async tx(fn) {
      const waitingFor = previous;
      let release!: () => void;
      previous = new Promise<void>((resolve) => { release = resolve; });
      await waitingFor;
      try {
        const working = structuredClone(state);
        const result = await fn(transaction(working));
        state = working;
        return result;
      } finally {
        release();
      }
    },
  };
}
