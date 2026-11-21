import type { Address } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { AgentConnectionRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob } from "./store.js";

type State = {
  users: Map<string, UserRow>;
  grants: (GrantRow & { revokedAt?: Date; friendDefault?: boolean })[];
  friends: Map<string, Set<Address>>;
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
  function putAgent(row: AgentConnectionRow): AgentConnectionRow {
    if (!state.users.has(row.userId)) {
      state.users.set(row.userId, { userId: row.userId, createdAt: structuredClone(row.createdAt) });
    }
    const stored = structuredClone(row);
    state.agents.set(agentKey(row.userId, row.agentId), stored);
    return stored;
  }

  function liveGrants(grantorUserId: string) {
    return state.grants.filter((grant) => grant.grantorUserId === grantorUserId && !grant.revokedAt);
  }

  function findGrant({ grantorUserId, granteeAddress, tool }: Pick<GrantRow, "grantorUserId" | "granteeAddress" | "tool">) {
    return liveGrants(grantorUserId).find((grant) => grant.granteeAddress === granteeAddress && grant.tool === tool);
  }

  function readGrant({ friendDefault: _friendDefault, ...row }: State["grants"][number]): GrantRow {
    return structuredClone(row);
  }

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
    async putGrant(row) {
      if (!state.users.has(row.grantorUserId)) state.users.set(row.grantorUserId, { userId: row.grantorUserId, createdAt: new Date() });
      const live = findGrant(row);
      if (!live) {
        state.grants.push(structuredClone(row));
        return structuredClone(row);
      }
      live.fields = structuredClone(row.fields);
      delete live.friendDefault;
      return readGrant(live);
    },
    async listGrants(grantorUserId) {
      return liveGrants(grantorUserId).map(readGrant);
    },
    async getGrant(grantorUserId, granteeAddress, tool) {
      const live = findGrant({ grantorUserId, granteeAddress, tool });
      return live ? readGrant(live) : null;
    },
    async revokeGrant(id, grantorUserId, at) {
      const live = liveGrants(grantorUserId).find((grant) => grant.id === id);
      if (!live) return false;
      live.revokedAt = structuredClone(at);
      return true;
    },
    async listFriends(userId) {
      return [...(state.friends.get(userId) ?? [])].sort();
    },
    async addFriend(userId, address) {
      const friends = state.friends.get(userId) ?? new Set<Address>();
      if (friends.has(address)) return false;
      friends.add(address);
      state.friends.set(userId, friends);
      return true;
    },
    async removeFriend(userId, address) {
      return state.friends.get(userId)?.delete(address) ?? false;
    },
    async insertFriendGrant(row) {
      if (findGrant(row)) return false;
      state.grants.push(structuredClone({ ...row, friendDefault: true }));
      return true;
    },
    async revokeFriendGrants(userId, address, at) {
      const defaults = liveGrants(userId).filter((grant) => grant.granteeAddress === address && grant.friendDefault);
      for (const grant of defaults) grant.revokedAt = structuredClone(at);
      return defaults.map((grant) => grant.id);
    },
    async listOpenInvitations(userId) {
      return structuredClone([...state.requests.values()]
        .filter((row) => row.tool === "connect" && (row.status === "awaiting_agent" || row.status === "awaiting_owner") &&
          (row.fromUserId === userId || row.toUserId === userId))
        .sort(byCreatedAt));
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
      const existing = state.agents.get(agentKey(row.userId, row.agentId));
      return structuredClone(existing ?? putAgent(row));
    },
    async upsertAgentConnection(row) {
      putAgent(row);
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
    users: new Map(), grants: [], friends: new Map(), requests: new Map(),
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
