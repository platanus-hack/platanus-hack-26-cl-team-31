import { Address, type ContactGroups, type ContactTag, type Sharing, type OwnerVault } from "@team-31/protocol";
import { directoryCircles, directoryContact, normalizeSearch, publicProfileLimit } from "./directory.js";
import { activeAgentConflict, BrokerError } from "../errors.js";
import { wakeClaim } from "./store.js";
import type {
  AgentConnectionRow, AskReceipt, ChannelRow, CircleMemberRow, CircleRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, WakeJob,
} from "./store.js";

type State = {
  vaults: Map<string, OwnerVault>;
  memberRules: Map<string, Map<Address, boolean>>;
  contactGroups: Map<string, ContactGroups["groups"]>;
  users: Map<string, UserRow>;
  grants: (GrantRow & { revokedAt?: Date })[];
  contacts: Map<string, Set<Address>>;
  contactTags: Map<string, Map<Address, ContactTag>>;
  tagPresets: Map<string, Partial<Record<ContactTag, Sharing>>>;
  circles: Map<string, CircleRow>;
  circleMembers: CircleMemberRow[];
  requests: Map<string, RequestRow>;
  askReceipts: Map<string, AskReceipt>;
  events: RequestEvent[];
  wakes: Map<string, WakeJob>;
  agents: Map<string, AgentConnectionRow>;
  channels: Map<string, ChannelRow>;
};

function pairKey(userId: string, name: string): string {
  return JSON.stringify([userId, name]);
}

function byCreatedAt(a: RequestRow, b: RequestRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

function transaction(state: State): StoreTx {
  function findUserByAddress(address: Address): UserRow | undefined {
    return [...state.users.values()].find((user) => user.address === address);
  }

  function canRead(owner: string, c: OwnerVault["categories"][number], reader: Address) {
    if (!state.contacts.get(owner)?.has(reader)) return false;
    const rule = state.memberRules.get(pairKey(owner, c.id))?.get(reader);
    if (rule !== undefined) return rule;
    const tag = state.contactTags.get(owner)?.get(reader);
    return (tag && c.groups.includes(tag)) || state.contactGroups.get(owner)?.some(group =>
      group.members.includes(reader) && c.contactGroups?.some(g => g.id === group.id));
  }

  function listRecipientRequests(address: Address, status: "awaiting_agent" | "awaiting_owner"): RequestRow[] {
    const ownerId = findUserByAddress(address)?.userId;
    if (!ownerId) return [];
    return structuredClone([...state.requests.values()]
      .filter((row) => row.toAddress === address && row.toUserId === ownerId && row.status === status)
      .sort(byCreatedAt));
  }

  function circleMember(circleId: string, address: Address) {
    return state.circleMembers.find((member) => member.circleId === circleId && member.address === address);
  }

  function ensureUser(userId: string, createdAt: Date) {
    if (!state.users.has(userId)) state.users.set(userId, { userId, createdAt: structuredClone(createdAt) });
  }

  function putAgent(row: AgentConnectionRow): AgentConnectionRow {
    if (!row.revokedAt && [...state.agents.values()].some(other =>
      other.userId === row.userId && other.agentId !== row.agentId && !other.revokedAt)) throw activeAgentConflict();
    ensureUser(row.userId, row.createdAt);
    const stored = structuredClone(row);
    state.agents.set(pairKey(row.userId, row.agentId), stored);
    return stored;
  }

  function liveGrants(grantorUserId: string) {
    return state.grants.filter((grant) => grant.grantorUserId === grantorUserId && !grant.revokedAt);
  }

  function findGrant({ grantorUserId, granteeAddress, category }: Pick<GrantRow, "grantorUserId" | "granteeAddress" | "category">) {
    return liveGrants(grantorUserId).find((grant) => grant.granteeAddress === granteeAddress && grant.category === category);
  }

  return {
    async networkAddresses(after, limit) {
      const connected = new Set([...state.agents.values()].map(agent => agent.userId));
      return [...state.users.values()].flatMap(({ userId, address }) =>
        address && connected.has(userId) && (!after || address > after) ? [address] : []).sort().slice(0, limit);
    },
    async vaultCatalog(owner) {
      return { categories: (state.vaults.get(owner)?.categories ?? []).map(({ id, name, groups, contactGroups }) =>
        structuredClone({ id, name, groups, contactGroups: contactGroups ?? [] })) };
    },
    async vaultMembers(owner, categoryId) {
      const category = state.vaults.get(owner)?.categories.find(c => c.id === categoryId);
      return category ? [...(state.contacts.get(owner) ?? [])].filter(address => canRead(owner, category, address)).sort() : null;
    },
    async contactGroups(owner) {
      return { groups: structuredClone(state.contactGroups.get(owner) ?? []).sort((a, b) => a.name.localeCompare(b.name)) };
    },
    async changeContactGroup(owner, id, change) {
      const groups = state.contactGroups.get(owner) ?? [];
      if (change.action === "create") {
        if (groups.some(g => g.name.toLowerCase() === change.name.toLowerCase())) {
          throw new BrokerError("conflict", "Ya tienes un grupo con ese nombre.");
        }
        state.contactGroups.set(owner, [...groups, { id, name: change.name, members: [] }]);
        return true;
      }
      const group = groups.find(g => g.id === id);
      if (!group) return false;
      if (change.action === "delete") {
        state.contactGroups.set(owner, groups.filter(g => g !== group));
        for (const category of state.vaults.get(owner)?.categories ?? []) {
          const others = category.contactGroups?.filter(g => g.id !== id);
          if (others?.length) category.contactGroups = others;
          else delete category.contactGroups;
        }
      } else if (change.action === "add_contact") {
        if (!state.contacts.get(owner)?.has(change.address)) return false;
        if (!group.members.includes(change.address)) group.members = [...group.members, change.address].sort();
      } else {
        group.members = group.members.filter(address => address !== change.address);
      }
      return true;
    },
    async ownerVault(owner) { return structuredClone(state.vaults.get(owner) ?? { categories: [] }); },
    async changeVault(owner, id, change) {
      const vault = state.vaults.get(owner) ?? { categories: [] };
      if (change.action === "create") {
        vault.categories.push({ id, name: change.name, entries: [], groups: [] });
        state.vaults.set(owner, vault);
        return true;
      }
      const c = vault.categories.find((item) => item.id === id);
      if (!c) return false;
      switch (change.action) {
        case "rename": c.name = change.name; break;
        case "delete":
          state.memberRules.delete(pairKey(owner, id));
          vault.categories = vault.categories.filter(item => item !== c);
          break;
        case "set_member": {
          if (!state.contacts.get(owner)?.has(change.address)) return false;
          const key = pairKey(owner, id);
          const rules = state.memberRules.get(key) ?? new Map<Address, boolean>();
          rules.set(change.address, change.allowed);
          state.memberRules.set(key, rules);
          break;
        }
        case "set_group":
          c.groups = c.groups.filter(group => group !== change.group);
          if (change.allowed) c.groups.push(change.group);
          break;
        case "set_contact_group": {
          const group = state.contactGroups.get(owner)?.find(g => g.id === change.groupId);
          if (!group) return false;
          const groups = (c.contactGroups ?? []).filter(g => g.id !== change.groupId);
          if (change.allowed) groups.push({ id: group.id, name: group.name });
          if (groups.length) c.contactGroups = groups.sort((a, b) => a.name.localeCompare(b.name));
          else delete c.contactGroups;
          break;
        }
        case "put_entry":
          c.entries = [...c.entries.filter(e => e.label !== change.label), { label: change.label, value: change.value }];
          break;
        case "delete_entry": c.entries = c.entries.filter(e => e.label !== change.label); break;
      }
      return true;
    },
    async sharedVault(reader, to, id) {
      const owner = findUserByAddress(to)?.userId;
      if (!owner) return { categories: [] };
      return { categories: (state.vaults.get(owner)?.categories ?? []).filter(c => (!id || id === c.id) && canRead(owner, c, reader))
        .map(c => ({ id: c.id, name: c.name, ...(id ? { entries: structuredClone(c.entries) } : {}) })) };
    },
    async searchPublicProfiles(query) {
      const term = normalizeSearch(query);
      const exact = Address.safeParse(term);
      return [...state.users.values()].flatMap(({ address, displayName }) => {
        if (!address) return [];
        const handle = address.split("@")[0]!;
        const name = normalizeSearch(displayName ?? "");
        if (exact.success ? address !== exact.data : !address.includes(term) && !name.includes(term)) return [];
        const rank = name === term || handle === term ? 0 : name.startsWith(term) || handle.startsWith(term) ? 1 : 2;
        return [{ rank, address, displayName: displayName || handle }];
      }).sort((a, b) => a.rank - b.rank || Buffer.compare(Buffer.from(a.address), Buffer.from(b.address)))
        .slice(0, publicProfileLimit).map(({ address, displayName }) => ({ address, displayName }));
    },
    async getUser(userId) {
      return structuredClone(state.users.get(userId) ?? null);
    },
    async getUserByAddress(address) {
      return structuredClone(findUserByAddress(address) ?? null);
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
      if (!live) state.grants.push(structuredClone(row));
      return structuredClone(live ?? row);
    },
    async listGrants(grantorUserId) {
      return structuredClone(liveGrants(grantorUserId));
    },
    async getGrant(grantorUserId, granteeAddress, category) {
      return structuredClone(findGrant({ grantorUserId, granteeAddress, category }) ?? null);
    },
    async revokeGrant(id, grantorUserId, at) {
      const live = liveGrants(grantorUserId).find((grant) => grant.id === id);
      if (!live) return false;
      live.revokedAt = structuredClone(at);
      return true;
    },
    async listContacts(userId) {
      const me = state.users.get(userId)?.address;
      if (!me) return [];
      return [...(state.contacts.get(userId) ?? [])].sort().map(address => {
        const other = findUserByAddress(address);
        const gives = liveGrants(userId).filter(g => g.granteeAddress === address);
        const receives = other ? liveGrants(other.userId).filter(g => g.granteeAddress === me) : [];
        return directoryContact({ address, name: other?.displayName, tag: state.contactTags.get(userId)?.get(address),
          gives: gives.map(g => g.category), receives: receives.map(g => g.category) });
      });
    },
    async listJoinedCircles(userId) {
      const me = state.users.get(userId)?.address;
      if (!me) return [];
      const joined = [...state.circles.values()].filter(c => circleMember(c.id, me)?.joinedAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      return directoryCircles(joined.flatMap(({ id, name: circleName }) => {
        const others = state.circleMembers.filter(m => m.circleId === id && m.joinedAt && m.address !== me)
          .map(m => m.address).sort();
        return [{ id, circleName }, ...others.map(address => ({
          id, circleName, address, memberName: findUserByAddress(address)?.displayName,
        }))];
      }));
    },
    async listContactAddresses(userId) {
      return [...(state.contacts.get(userId) ?? [])].sort();
    },
    async addContact(userId, address) {
      const contacts = state.contacts.get(userId) ?? new Set<Address>();
      if (contacts.has(address)) return false;
      contacts.add(address);
      state.contacts.set(userId, contacts);
      return true;
    },
    async removeContact(userId, address) {
      for (const c of state.vaults.get(userId)?.categories ?? []) state.memberRules.get(pairKey(userId, c.id))?.delete(address);
      for (const group of state.contactGroups.get(userId) ?? []) group.members = group.members.filter(member => member !== address);
      return state.contacts.get(userId)?.delete(address) ?? false;
    },
    async listContactTags(userId) {
      return new Map(state.contactTags.get(userId));
    },
    async setContactTag(userId, address, tag) {
      const tags = state.contactTags.get(userId) ?? new Map<Address, ContactTag>();
      if (tag) tags.set(address, tag);
      else tags.delete(address);
      state.contactTags.set(userId, tags);
    },
    async listTagPresets(userId) {
      return structuredClone(state.tagPresets.get(userId) ?? {});
    },
    async putTagPreset(userId, tag, sharing) {
      state.tagPresets.set(userId, { ...state.tagPresets.get(userId), [tag]: [...sharing] });
    },
    async listOpenInvitations(userId) {
      return structuredClone([...state.requests.values()]
        .filter((row) => row.tool === "connect" && (row.status === "awaiting_agent" || row.status === "awaiting_owner") &&
          (row.fromUserId === userId || row.toUserId === userId))
        .sort(byCreatedAt));
    },
    async insertCircle(row) {
      if (state.circles.has(row.id)) throw new BrokerError("conflict", "El círculo ya existe.");
      state.circles.set(row.id, structuredClone(row));
    },
    async getCircle(id) {
      return structuredClone(state.circles.get(id) ?? null);
    },
    async deleteCircle(id) {
      state.circles.delete(id);
      state.circleMembers = state.circleMembers.filter((member) => member.circleId !== id);
    },
    async listCircles(address) {
      const ids = new Set(state.circleMembers.filter((member) => member.address === address).map((member) => member.circleId));
      return structuredClone([...state.circles.values()].filter((circle) => ids.has(circle.id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)));
    },
    async listCircleMembers(circleId) {
      return structuredClone(state.circleMembers.filter((member) => member.circleId === circleId)
        .sort((a, b) => a.address.localeCompare(b.address)));
    },
    async inviteCircleMember(circleId, address) {
      if (!circleMember(circleId, address)) state.circleMembers.push({ circleId, address });
    },
    async joinCircle(circleId, address, at) {
      const member = circleMember(circleId, address);
      if (!member || member.joinedAt) return false;
      member.joinedAt = structuredClone(at);
      return true;
    },
    async removeCircleMember(circleId, address) {
      const member = circleMember(circleId, address);
      state.circleMembers = state.circleMembers.filter((current) => current !== member);
      return member !== undefined;
    },
    async lockRequiredRelation(userId, from, to, relation) {
      if (relation.kind === "circle") {
        return Boolean(circleMember(relation.circleId, from)?.joinedAt && circleMember(relation.circleId, to)?.joinedAt);
      }
      return Boolean(state.contacts.get(userId)?.has(to)) &&
        (relation.tag === undefined || state.contactTags.get(userId)?.get(to) === relation.tag);
    },
    async lockAskReceipt(keyHash) { return structuredClone(state.askReceipts.get(keyHash) ?? null); },
    async insertAskReceipt(receipt) { state.askReceipts.set(receipt.keyHash, structuredClone(receipt)); },
    async shareCircle(a, b) {
      const joined = (address: Address) => state.circleMembers
        .filter((member) => member.address === address && member.joinedAt).map((member) => member.circleId);
      const circlesOfB = new Set(joined(b));
      return joined(a).some((circleId) => circlesOfB.has(circleId));
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
      return listRecipientRequests(address, "awaiting_agent");
    },
    async listOwnerPending(address) {
      return listRecipientRequests(address, "awaiting_owner");
    },
    async listActivity(address, limit, requestId) {
      const ownerId = findUserByAddress(address)?.userId;
      if (!ownerId) return [];
      const candidates = requestId === undefined ? state.requests.values() : [state.requests.get(requestId)];
      return structuredClone([...candidates]
        .filter((row): row is RequestRow => row !== undefined && (
          (row.toAddress === address && row.toUserId === ownerId) ||
          (row.fromAddress === address && row.fromUserId === ownerId)
        ))
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
    async claimDueWakes(now, leaseUntil, limit) {
      const jobs = [...state.wakes.values()].filter((job) => job.state !== "done" && job.runAt <= now)
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit);
      return jobs.map((job) => {
        const recovered = job.state === "running";
        const dueAt = job.runAt;
        job.state = "running";
        job.runAt = structuredClone(leaseUntil);
        if (recovered) job.attempt++;
        return structuredClone(wakeClaim(job, recovered, dueAt));
      });
    },
    async recordWakeAttempt(claim, now, result, nextRunAt) {
      const job = state.wakes.get(claim.id);
      if (!job || job.state !== "running" || job.attempt !== claim.attempt || job.runAt <= now) return false;
      job.lastResult = structuredClone(result);
      job.state = nextRunAt ? "queued" : "done";
      job.runAt = structuredClone(nextRunAt ?? now);
      if (nextRunAt) job.attempt++;
      return true;
    },
    async getWakeForUpdate(requestId, requestVersion) {
      const job = [...state.wakes.values()].find((wake) =>
        wake.requestId === requestId && wake.requestVersion === requestVersion);
      return structuredClone(job ?? null);
    },
    async expediteQueuedWake(id, now) {
      const job = state.wakes.get(id);
      if (job?.state === "queued" && job.runAt > now) job.runAt = structuredClone(now);
    },
    async ensureAgentConnection(row, onCreated) {
      const existing = state.agents.get(pairKey(row.userId, row.agentId));
      if (existing) return structuredClone(existing);
      const created = putAgent(row);
      onCreated?.();
      return structuredClone(created);
    },
    async upsertAgentConnection(row) {
      putAgent(row);
    },
    async listPublicAgents() {
      return [...state.agents.values()].flatMap((agent) => {
        const address = state.users.get(agent.userId)?.address;
        return address && !agent.revokedAt ? [{ agentId: agent.agentId, label: agent.label, address }] : [];
      }).sort((a, b) => a.label.localeCompare(b.label) || a.address.localeCompare(b.address));
    },
    async listAgentConnections(userId) {
      const connections = [...state.agents.values()].filter((row) => row.userId === userId);
      connections.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        || Buffer.compare(Buffer.from(a.agentId), Buffer.from(b.agentId)));
      return structuredClone(connections);
    },
    async getAgentConnection(userId, agentId) {
      return structuredClone(state.agents.get(pairKey(userId, agentId)) ?? null);
    },
    async putChannel(row) {
      ensureUser(row.userId, row.createdAt);
      state.channels.set(pairKey(row.userId, row.name), structuredClone(row));
    },
    async getChannel(userId, name) {
      return structuredClone(state.channels.get(pairKey(userId, name)) ?? null);
    },
  };
}

export function createMemoryStore(): Store {
  let state: State = {
    vaults: new Map(), memberRules: new Map(), contactGroups: new Map(), users: new Map(), grants: [], contacts: new Map(), contactTags: new Map(), tagPresets: new Map(), circles: new Map(), circleMembers: [], requests: new Map(),
    askReceipts: new Map(), events: [], wakes: new Map(), agents: new Map(), channels: new Map(),
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
