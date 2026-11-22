import { Address, Category, defaultTags, defaultVaultCategories, type OwnerVault, type Tag } from "@team-31/protocol";
import { directoryCircles, directoryContact, normalizeSearch, publicProfileLimit, sortTags } from "./directory.js";
import { activeAgentConflict, BrokerError, notFound } from "../errors.js";
import { wakeClaim } from "./store.js";
import type {
  AgentConnectionRow, AskReceipt, ChannelRow, CircleMemberRow, CircleRow, GrantRow, RequestEvent, RequestRow, Store, StoreTx, UserRow, VaultDocumentRow, WakeJob,
} from "./store.js";

type State = {
  vaults: Map<string, OwnerVault>;
  memberRules: Map<string, Map<Address, boolean>>;
  users: Map<string, UserRow>;
  grants: (GrantRow & { revokedAt?: Date })[];
  contacts: Map<string, Set<Address>>;
  contactTags: Map<string, Map<Address, string[]>>;
  tags: Map<string, Omit<Tag, "categories">[]>;
  circles: Map<string, CircleRow>;
  circleMembers: CircleMemberRow[];
  requests: Map<string, RequestRow>;
  askReceipts: Map<string, AskReceipt>;
  events: RequestEvent[];
  wakes: Map<string, WakeJob>;
  agents: Map<string, AgentConnectionRow>;
  channels: Map<string, ChannelRow>;
  documents: Map<string, VaultDocumentRow>;
  documentKeys: Map<string, string>;
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
    // An individual decision exists only for a contact, and it wins. A public category is read by any user.
    const rule = state.memberRules.get(pairKey(owner, c.id))?.get(reader);
    if (rule !== undefined) return rule;
    if (c.visibility === "public") return true;
    // A grant written before the vault held the permissions still opens the default category of its id.
    if (state.grants.some(g => g.grantorUserId === owner && g.granteeAddress === reader && g.category === c.id && !g.revokedAt)) return true;
    return !!state.contacts.get(owner)?.has(reader) && (state.contactTags.get(owner)?.get(reader) ?? []).some(tag => c.tags.includes(tag));
  }

  function listRecipientRequests(address: Address, status: "awaiting_agent" | "awaiting_owner"): RequestRow[] {
    const ownerId = findUserByAddress(address)?.userId;
    if (!ownerId) return [];
    return structuredClone([...state.requests.values()]
      .filter((row) => row.toAddress === address && row.toUserId === ownerId && row.status === status)
      .sort(byCreatedAt));
  }

  // Every holder starts with the default categories and tags, and each default tag opens its categories.
  // A deleted default stays deleted.
  function vaultOf(owner: string): OwnerVault {
    if (!state.vaults.has(owner) && state.users.has(owner)) {
      state.vaults.set(owner, { categories: defaultVaultCategories.map(category => ({
        ...category, visibility: "private", entries: [], tags: defaultTags.filter(tag => tag.categories.includes(category.id)).map(tag => tag.id),
      })) });
      state.tags.set(owner, defaultTags.map(({ id, name, color }) => ({ id, name, color })));
    }
    return state.vaults.get(owner) ?? { categories: [] };
  }

  function tagsOf(userId: string) {
    ensureUser(userId, new Date());
    vaultOf(userId);
    return state.tags.get(userId)!;
  }

  function categoryMembers(owner: string, category: OwnerVault["categories"][number]) {
    return [...(state.contacts.get(owner) ?? [])].filter(address => canRead(owner, category, address)).sort();
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
    async networkAddresses(after, limit, q) {
      const connected = new Set([...state.agents.values()].map(agent => agent.userId));
      return [...state.users.values()].flatMap(({ userId, address }) =>
        address && connected.has(userId) && (!after || address > after) && (!q || address.includes(q)) ? [address] : []).sort().slice(0, limit);
    },
    async vaultCatalog(owner) {
      return { categories: vaultOf(owner).categories.map(({ id, name, description, visibility, tags }) =>
        structuredClone({ id, name, ...(description ? { description } : {}), visibility, tags: [...tags].sort() })) };
    },
    async canReadVault(owner, reader, categoryId) {
      const category = vaultOf(owner).categories.find(c => c.id === categoryId);
      return !!category && canRead(owner, category, reader);
    },
    async vaultMembers(owner, categoryId) {
      const category = vaultOf(owner).categories.find(c => c.id === categoryId);
      return category ? categoryMembers(owner, category) : null;
    },
    async ownerVault(owner) {
      const vault = structuredClone(vaultOf(owner));
      for (const category of vault.categories) {
        category.members = categoryMembers(owner, category);
        category.tags.sort();
      }
      return vault;
    },
    async changeVault(owner, id, change) {
      const vault = vaultOf(owner);
      if (change.action === "create") {
        vault.categories.push({ id, name: change.name, visibility: change.visibility ?? "private", entries: [], tags: [] });
        state.vaults.set(owner, vault);
        return true;
      }
      const c = vault.categories.find((item) => item.id === id);
      if (!c) return false;
      switch (change.action) {
        case "rename": c.name = change.name; break;
        case "describe":
          if (change.description) c.description = change.description;
          else delete c.description;
          break;
        case "set_visibility": c.visibility = change.visibility; break;
        case "delete":
          state.memberRules.delete(pairKey(owner, id));
          for (const document of state.documents.values()) {
            if (document.owner === owner && document.categoryId === id) {
              state.documents.delete(document.id);
              state.documentKeys.delete(pairKey(owner, document.idempotencyKey));
            }
          }
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
        case "clear_member": state.memberRules.get(pairKey(owner, id))?.delete(change.address); break;
        case "set_tag":
          if (!state.tags.get(owner)?.some(tag => tag.id === change.tagId)) return false;
          c.tags = c.tags.filter(tag => tag !== change.tagId);
          if (change.allowed) c.tags.push(change.tagId);
          break;
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
      // Listing shows every category. Opening one requires the read.
      return { categories: vaultOf(owner).categories.filter(c => !id || id === c.id && canRead(owner, c, reader))
        .map(c => {
          const documents = id
            ? [...state.documents.values()]
              .filter(document => document.owner === owner && document.categoryId === c.id)
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
              .map(document => ({
                id: document.id,
                fileName: document.fileName,
                ...(document.mimeType ? { mimeType: document.mimeType } : {}),
                sizeBytes: document.sizeBytes,
                sha256: document.sha256,
                createdAt: document.createdAt.toISOString(),
              }))
            : [];
          return {
            id: c.id,
            name: c.name,
            ...(c.description ? { description: c.description } : {}),
            visibility: c.visibility,
            canRead: canRead(owner, c, reader),
            ...(id ? { entries: structuredClone(c.entries) } : {}),
            ...(documents.length ? { documents } : {}),
          };
        }) };
    },
    async putVaultDocument(row) {
      const key = pairKey(row.owner, row.idempotencyKey);
      const existingId = state.documentKeys.get(key);
      if (existingId) {
        const existing = state.documents.get(existingId);
        if (existing && existing.categoryId === row.categoryId && existing.fileName === row.fileName &&
            existing.mimeType === row.mimeType && existing.sha256 === row.sha256 && existing.sizeBytes === row.sizeBytes &&
            Buffer.from(existing.content).equals(Buffer.from(row.content))) {
          return structuredClone(existing);
        }
        throw new BrokerError("conflict", "La clave de idempotencia ya fue usada para otro archivo.");
      }
      if (!vaultOf(row.owner).categories.some(category => category.id === row.categoryId)) return null;
      state.documents.set(row.id, structuredClone(row));
      state.documentKeys.set(key, row.id);
      return structuredClone(row);
    },
    async sharedVaultDocument(reader, to, query) {
      const owner = findUserByAddress(to)?.userId;
      if (!owner) return null;
      const category = state.vaults.get(owner)?.categories.find(item => item.id === query.categoryId);
      if (!category || (reader !== to && !canRead(owner, category, reader))) return null;
      const document = state.documents.get(query.documentId);
      if (!document || document.owner !== owner || document.categoryId !== query.categoryId) return null;
      return structuredClone(document);
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
        const readable = (owner: string, reader: Address) => vaultOf(owner).categories.filter(c => canRead(owner, c, reader)).map(c => c.id);
        return directoryContact({ address, name: other?.displayName, tags: state.contactTags.get(userId)?.get(address),
          gives: readable(userId, address), receives: other ? readable(other.userId, me) : [] });
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
      return state.contacts.get(userId)?.delete(address) ?? false;
    },
    async listTags(userId) {
      const open = (id: string) => vaultOf(userId).categories.filter(c => c.tags.includes(id)).map(c => c.id);
      return sortTags(tagsOf(userId).map(tag => ({ ...tag, categories: Category.options.filter(id => open(tag.id).includes(id)) })));
    },
    async putTag(userId, { categories, ...tag }) {
      const tags = tagsOf(userId);
      if (tags.some(other => other.id !== tag.id && other.name.toLowerCase() === tag.name.toLowerCase())) {
        throw new BrokerError("conflict", "Ya tienes una etiqueta con ese nombre.");
      }
      state.tags.set(userId, [...tags.filter(other => other.id !== tag.id), tag]);
      for (const c of vaultOf(userId).categories.filter(c => Category.options.some(id => id === c.id))) {
        c.tags = c.tags.filter(id => id !== tag.id);
        if (categories.some(id => id === c.id)) c.tags.push(tag.id);
      }
    },
    async deleteTag(userId, tagId) {
      const tags = state.tags.get(userId) ?? [];
      if (!tags.some(tag => tag.id === tagId)) return false;
      state.tags.set(userId, tags.filter(tag => tag.id !== tagId));
      for (const [address, ids] of state.contactTags.get(userId) ?? []) {
        state.contactTags.get(userId)!.set(address, ids.filter(id => id !== tagId));
      }
      for (const category of state.vaults.get(userId)?.categories ?? []) category.tags = category.tags.filter(id => id !== tagId);
      return true;
    },
    async listContactTags(userId) {
      return new Map([...(state.contactTags.get(userId) ?? [])].flatMap(([address, ids]) => ids.length ? [[address, [...ids].sort()] as const] : []));
    },
    async setContactTags(userId, address, tagIds) {
      const known = state.tags.get(userId) ?? [];
      if (tagIds.some(id => !known.some(tag => tag.id === id))) return false;
      const tags = state.contactTags.get(userId) ?? new Map<Address, string[]>();
      tags.set(address, [...new Set(tagIds)].sort());
      state.contactTags.set(userId, tags);
      return true;
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
        (relation.tag === undefined || Boolean(state.contactTags.get(userId)?.get(to)?.includes(relation.tag)));
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
    async reviveAgentConnection(row) {
      if (row.revokedBy === "admin") throw notFound();
      return structuredClone(putAgent({
        ...row, revokedAt: undefined, revokedBy: undefined, verifiedAt: undefined, wakeTarget: { kind: "none" },
      }));
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
    vaults: new Map(), memberRules: new Map(), users: new Map(), grants: [], contacts: new Map(), contactTags: new Map(), tags: new Map(), circles: new Map(), circleMembers: [], requests: new Map(),
    askReceipts: new Map(), events: [], wakes: new Map(), agents: new Map(), channels: new Map(), documents: new Map(), documentKeys: new Map(),
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
