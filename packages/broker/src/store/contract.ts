import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentConnectionRow, GrantRow, RequestRow, Store, WakeJob } from "./store.js";

// makeStore supplies an isolated store per test, including an empty wake queue.
export function runStoreContractTests(makeStore: () => Store | Promise<Store>): void {
  const now = new Date("2026-11-21T15:00:00Z");
  const fromAddress = "alice@sideband.app";
  const toAddress = "bruno@sideband.app";
  let store: Store;

  function grantTo(granteeAddress: string): GrantRow {
    return { id: randomUUID(), grantorUserId: "alice", granteeAddress, category: "general", createdAt: now };
  }

  async function makeRequest(overrides: Partial<RequestRow> = {}): Promise<RequestRow> {
    const row: RequestRow = {
      id: randomUUID(), fromUserId: "alice", toUserId: "bruno", fromAddress, toAddress,
      tool: "question", args: { text: "Hola", category: "general" }, status: "awaiting_agent", allowedFields: ["answer"],
      guidance: "", rule: "test", envelopeSignature: "envelope", escalated: false, createdAt: now,
      expiresAt: now, version: 0, ...overrides,
    };
    await store.tx((tx) => tx.insertRequest(row));
    return row;
  }

  describe("Store", () => {
    beforeEach(async () => {
      store = await makeStore();
      await store.tx(async (tx) => {
        await tx.createAddress("alice", fromAddress);
        await tx.createAddress("bruno", toAddress);
      });
    });

    it("pages network addresses once per holder with connection history, including revoked agents", async () => {
      await store.tx(async tx => {
        const agent = { agentId: "old", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now } as const;
        expect(await tx.networkAddresses(undefined, 2)).toEqual([]);
        await tx.upsertAgentConnection({ ...agent, userId: "alice", revokedAt: now });
        await tx.upsertAgentConnection({ ...agent, userId: "bruno", revokedAt: now });
        await tx.upsertAgentConnection({ ...agent, userId: "bruno", agentId: "new" });
        await tx.upsertAgentConnection({ ...agent, userId: "no-address" });
        expect(await tx.networkAddresses(undefined, 1)).toEqual([fromAddress]);
        expect(await tx.networkAddresses(fromAddress, 2)).toEqual([toAddress]);
        expect(await tx.networkAddresses(undefined, 1, "run")).toEqual([toAddress]);
        expect(await tx.networkAddresses(undefined, 2, "%")).toEqual([]);
        expect(await tx.networkAddresses(toAddress, 2)).toEqual([]);
      });
    });

    it("isolates two owners' tags and presets for the same contact", async () => {
      await store.tx(async (tx) => {
        for (const user of ["alice", "bruno"]) {
          await tx.addContact(user, "carla@sideband.app");
          await tx.setContactTag(user, "carla@sideband.app", "family");
        }
        await tx.putTagPreset("alice", "family", ["general"]);
        await tx.putTagPreset("bruno", "family", ["interests"]);
      });
      await store.tx(async (tx) => {
        await tx.setContactTag("alice", "carla@sideband.app", null);
        await tx.putTagPreset("alice", "family", ["availability"]);
      });
      await store.tx(async (tx) => {
        expect((await tx.listContactTags("alice")).has("carla@sideband.app")).toBe(false);
        expect((await tx.listContactTags("bruno")).get("carla@sideband.app")).toBe("family");
        expect((await tx.listTagPresets("alice")).family).toEqual(["availability"]);
        expect((await tx.listTagPresets("bruno")).family).toEqual(["interests"]);
      });
    });

    it("rolls back addresses, grants, requests and their events when a transaction rejects", async () => {
      const row = await makeRequest();
      await expect(store.tx(async (tx) => {
        await tx.createAddress("carla", "carla@sideband.app");
        await tx.putGrant(grantTo(toAddress));
        await tx.updateRequest(row.id, { status: "awaiting_owner" }, row.version);
        await tx.appendEvent({ requestId: row.id, at: now, kind: "permission" });
        throw new Error("rollback");
      })).rejects.toThrow("rollback");

      await store.tx(async (tx) => {
        expect(await tx.getUser("carla")).toBeNull();
        expect(await tx.listGrants("alice")).toEqual([]);
        expect(await tx.getRequest(row.id)).toMatchObject({ status: "awaiting_agent", version: 0 });
        expect(await tx.listEvents([row.id])).toEqual([]);
      });
    });

    it("proyecta únicamente grants vivos de cada contacto y miembros aceptados en los círculos propios", async () => {
      const carla = "carla@sideband.app";
      const others = "otros@sideband.app";
      const circleId = randomUUID();
      await store.tx(async tx => {
        await tx.createAddress("carla", carla);
        await tx.addContact("alice", toAddress);
        await tx.setContactTag("alice", toAddress, "family");
        await tx.putGrant(grantTo(toAddress));
        await tx.putGrant({ ...grantTo(toAddress), category: "availability" });
        await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "bruno", category: "interests" });
        const revoked = await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "bruno" });
        await tx.revokeGrant(revoked.id, "bruno", now);
        await tx.putGrant({ ...grantTo(carla), grantorUserId: "bruno", category: "health" });
        await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "carla", category: "health" });
        expect(await tx.listContacts("alice")).toEqual([{
          address: toAddress, tag: "family", gives: ["availability", "general"], receives: ["interests"],
        }]);
        await tx.insertCircle({ id: circleId, ownerUserId: "alice", name: "Fútbol", createdAt: now });
        for (const address of [fromAddress, toAddress, carla, others]) await tx.inviteCircleMember(circleId, address);
        await tx.joinCircle(circleId, fromAddress, now);
        expect(await tx.listJoinedCircles("alice")).toEqual([{ id: circleId, name: "Fútbol", members: [] }]);
        await tx.joinCircle(circleId, carla, now);
        expect(await tx.listJoinedCircles("alice")).toEqual([{ id: circleId, name: "Fútbol", members: [carla] }]);
        expect(await tx.listJoinedCircles("bruno")).toEqual([]);
      });
    });

    it("busca direcciones literalmente y prioriza coincidencias exactas antes del límite público", async () => {
      await store.tx(async tx => {
        for (let n = 1; n <= 26; n++) await tx.createAddress("match" + n, `a-ana-${n}@sideband.app`);
        await tx.createAddress("exact", "ana@sideband.app");
        await tx.createAddress("literal", "ana_x@sideband.app");
        const profiles = await tx.searchPublicProfiles("Ana");
        expect(profiles).toHaveLength(25);
        expect(profiles[0]).toEqual({ address: "ana@sideband.app", displayName: "ana" });
        expect(await tx.searchPublicProfiles("ANA_X@SIDEBAND.APP")).toEqual([{ address: "ana_x@sideband.app", displayName: "ana_x" }]);
        expect(await tx.searchPublicProfiles("_x")).toHaveLength(1);
        expect(await tx.searchPublicProfiles("%_")).toEqual([]);
      });
    });

    it("keeps owner catalogs metadata-only and attaches contents to the right owner and category", async () => {
      const first = randomUUID();
      const second = randomUUID();
      await store.tx(async tx => {
        await tx.changeVault("alice", first, { action: "create", name: "Agenda" });
        await tx.changeVault("alice", second, { action: "create", name: "Salud" });
        await tx.changeVault("bruno", first, { action: "create", name: "Trabajo" });
        await tx.changeVault("alice", first, { action: "put_entry", categoryId: first, label: "Días", value: 2 });
        await tx.changeVault("bruno", first, { action: "put_entry", categoryId: first, label: "Días", value: 3 });
        await tx.changeVault("alice", second, { action: "set_group", categoryId: second, group: "family", allowed: true });

        expect(await tx.vaultCatalog("alice")).toEqual({ categories: [
          { id: first, name: "Agenda", groups: [], contactGroups: [] },
          { id: second, name: "Salud", groups: ["family"], contactGroups: [] },
        ] });
        expect(await tx.ownerVault("alice")).toEqual({ categories: [
          { id: first, name: "Agenda", entries: [{ label: "Días", value: 2 }], groups: [], members: [] },
          { id: second, name: "Salud", entries: [], groups: ["family"], members: [] },
        ] });
      });
    });

    it("uses the same effective category access for roster, discovery and reading entries", async () => {
      const categoryId = randomUUID();
      const member = { action: "set_member", categoryId, address: fromAddress, allowed: true } as const;
      await store.tx(async tx => {
        await tx.changeVault("bruno", categoryId, { action: "create", name: "Salud" });
        expect(await tx.vaultMembers("alice", categoryId)).toBeNull();
        expect(await tx.changeVault("bruno", categoryId, member)).toBe(false);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([]);
        expect(await tx.changeVault("bruno", categoryId, member)).toBe(true);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([fromAddress]);
        expect((await tx.ownerVault("bruno")).categories[0]?.members).toEqual([fromAddress]);
        expect((await tx.sharedVault(fromAddress, toAddress, categoryId)).categories).toHaveLength(1);
        await tx.setContactTag("bruno", fromAddress, "family");
        await tx.changeVault("bruno", categoryId, { action: "set_group", categoryId, group: "family", allowed: true });
        await tx.changeVault("bruno", categoryId, { ...member, allowed: false });
        expect((await tx.ownerVault("bruno")).categories[0]?.members).toEqual([]);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([]);
        expect(await tx.sharedVault(fromAddress, toAddress)).toEqual({ categories: [] });
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        await tx.changeVault("bruno", categoryId, member);
        await tx.removeContact("bruno", fromAddress);
        await tx.setContactTag("bruno", fromAddress, null);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([]);
      });
    });

    it("filters vault entries by the owner's current tag and accepted contact before reading", async () => {
      const id = randomUUID();
      await store.tx(async tx => {
        await tx.changeVault("bruno", id, { action: "create", name: "Necesidades" });
        await tx.changeVault("bruno", id, { action: "put_entry", categoryId: id, label: "Sábado", value: "Taladro" });
        await tx.changeVault("bruno", id, { action: "set_group", categoryId: id, group: "family", allowed: true });
        await tx.setContactTag("bruno", fromAddress, "family");
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.addContact("bruno", fromAddress);
        expect(await tx.sharedVault(fromAddress, toAddress)).toEqual({ categories: [{ id, name: "Necesidades" }] });
        expect((await tx.sharedVault(fromAddress, toAddress, id)).categories[0]?.entries).toEqual([{ label: "Sábado", value: "Taladro" }]);
        expect(await tx.changeVault("alice", id, { action: "delete", categoryId: id })).toBe(false);
        await tx.setContactTag("bruno", fromAddress, "work");
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.changeVault("bruno", id, { action: "delete", categoryId: id });
        expect(await tx.ownerVault("bruno")).toEqual({ categories: [] });
      });
    });

    it("limits custom vault groups to accepted contacts and revokes access on removal", async () => {
      const categoryId = randomUUID();
      const groupId = randomUUID();
      await store.tx(async tx => {
        const share = { action: "set_contact_group", categoryId, groupId, allowed: true } as const;
        const add = { action: "add_contact", groupId, address: fromAddress } as const;
        await tx.changeContactGroup("bruno", groupId, { action: "create", name: "Instituciones" });
        await tx.changeVault("bruno", categoryId, { action: "create", name: "Privada" });
        await tx.changeVault("bruno", categoryId, { action: "put_entry", categoryId, label: "Dato", value: "Prueba" });
        expect(await tx.changeContactGroup("bruno", groupId, add)).toBe(false);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.changeContactGroup("alice", groupId, add)).toBe(false);
        await tx.changeContactGroup("bruno", groupId, add);
        await tx.changeContactGroup("bruno", groupId, add);
        expect(await tx.contactGroups("bruno")).toEqual({ groups: [{ id: groupId, name: "Instituciones", members: [fromAddress] }] });
        expect(await tx.contactGroups("alice")).toEqual({ groups: [] });
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        await tx.changeVault("bruno", categoryId, share);
        expect((await tx.ownerVault("bruno")).categories[0]?.members).toEqual([fromAddress]);
        expect(await tx.vaultCatalog("bruno")).toEqual({ categories: [
          { id: categoryId, name: "Privada", groups: [], contactGroups: [{ id: groupId, name: "Instituciones" }] },
        ] });
        expect(await tx.sharedVault(fromAddress, toAddress)).toEqual({ categories: [{ id: categoryId, name: "Privada" }] });
        expect((await tx.sharedVault(fromAddress, toAddress, categoryId)).categories[0]?.entries).toEqual([{ label: "Dato", value: "Prueba" }]);
        expect(await tx.sharedVault("eva@sideband.app", toAddress, categoryId)).toEqual({ categories: [] });
        expect((await tx.ownerVault("bruno")).categories[0]?.contactGroups).toEqual([{ id: groupId, name: "Instituciones" }]);
        await tx.changeContactGroup("bruno", groupId, { ...add, action: "remove_contact" });
        expect(await tx.sharedVault(fromAddress, toAddress)).toEqual({ categories: [] });
        await tx.changeContactGroup("bruno", groupId, add);
        await tx.removeContact("bruno", fromAddress);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        await tx.changeContactGroup("bruno", groupId, add);
        await tx.changeContactGroup("bruno", groupId, { action: "delete", groupId });
        expect((await tx.vaultCatalog("bruno")).categories[0]?.contactGroups).toEqual([]);
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        expect(await tx.contactGroups("bruno")).toEqual({ groups: [] });
        expect((await tx.ownerVault("bruno")).categories[0]).toMatchObject({ entries: [{ label: "Dato", value: "Prueba" }] });
        expect((await tx.ownerVault("bruno")).categories[0]?.contactGroups).toBeUndefined();
      });
    });

    it("lists each active agent with an address and exposes only its public fields", async () => {
      await store.tx(async (tx) => {
        const agent = { userId: "alice", agentId: "client-1", label: "Alba", wakeTarget: { kind: "none" }, createdAt: now } as const;
        await tx.ensureAgentConnection(agent);
        await tx.ensureAgentConnection({ ...agent, userId: "bruno" });
        await tx.ensureAgentConnection({ ...agent, userId: "addressless" });
        await tx.upsertAgentConnection({ ...agent, agentId: "old", revokedAt: now });
        expect(await tx.listPublicAgents()).toEqual([
          { agentId: "client-1", label: "Alba", address: fromAddress }, { agentId: "client-1", label: "Alba", address: toAddress },
        ]);
      });
    });

    it("allows one address per user and one user per address", async () => {
      await expect(store.tx((tx) => tx.createAddress("carla", fromAddress))).rejects.toMatchObject({ code: "conflict" });
      await expect(store.tx((tx) => tx.createAddress("alice", "other@sideband.app"))).rejects.toMatchObject({ code: "conflict" });
      await store.tx(async (tx) => {
        const grant = await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "carla" });
        expect(await tx.getUser("carla")).toMatchObject({ userId: "carla" });
        await tx.createAddress("carla", "carla@sideband.app");
        expect(await tx.listGrants("carla")).toEqual([grant]);
        expect(await tx.getUserByAddress("carla@sideband.app")).toMatchObject({ userId: "carla" });
      });
    });

    it("filters requests by participant and pending state, and lists only requested events in order", async () => {
      const inbox = await makeRequest();
      const pending = await makeRequest({ status: "awaiting_owner" });
      const final = await makeRequest({ status: "denied", outcome: "denied", responseSignature: "response", closedAt: now });
      await store.tx(async (tx) => {
        await tx.appendEvent({ requestId: inbox.id, at: now, kind: "received" });
        await tx.appendEvent({ requestId: pending.id, at: now, kind: "received" });
        await tx.appendEvent({ requestId: inbox.id, at: now, kind: "permission", status: "awaiting_agent" });
        expect(await tx.getRequest(inbox.id, { fromUserId: "bruno" })).toBeNull();
        expect(await tx.getRequest(inbox.id, { toUserId: "alice" })).toBeNull();
        expect(await tx.getRequest(inbox.id, { fromUserId: "alice" })).toMatchObject({ id: inbox.id });
        expect((await tx.listInbox(toAddress)).map(({ id }) => id)).toEqual([inbox.id]);
        expect((await tx.listOwnerPending(toAddress)).map(({ id }) => id)).toEqual([pending.id]);
        expect(await tx.listActivity("someone@sideband.app", 10)).toEqual([]);
        expect((await tx.listActivity(fromAddress, 10)).map(({ id }) => id)).toEqual(expect.arrayContaining([inbox.id, pending.id, final.id]));
        expect((await tx.listActivity(fromAddress, 1))).toHaveLength(1);
        expect((await tx.listActivity(fromAddress, 1, inbox.id)).map((row) => row.id)).toEqual([inbox.id]);
        expect(await tx.listActivity("someone@sideband.app", 1, inbox.id)).toEqual([]);
        expect((await tx.listDueForExpiry(now, 10)).map(({ id }) => id)).toEqual(expect.arrayContaining([inbox.id, pending.id]));
        expect((await tx.listDueForExpiry(now, 10)).map(({ id }) => id)).not.toContain(final.id);
        expect(await tx.listEvents([])).toEqual([]);
        expect((await tx.listEvents([inbox.id])).map(({ kind }) => kind)).toEqual(["received", "permission"]);
      });
    });

    it("filters historical address matches before limiting the current recipient's activity", async () => {
      const address = "carla@sideband.app";
      const historical = await makeRequest({
        toAddress: address, toUserId: null, createdAt: new Date(now.getTime() + 1),
      });
      await store.tx((tx) => tx.createAddress("carla", address));
      const current = await makeRequest({ toAddress: address, toUserId: "carla" });
      await store.tx(async (tx) => {
        expect((await tx.listActivity(address, 1)).map(({ id }) => id)).toEqual([current.id]);
        expect((await tx.listInbox(address)).map(({ id }) => id)).toEqual([current.id]);
        expect((await tx.listActivity(fromAddress, 1)).map(({ id }) => id)).toEqual([historical.id]);
      });
    });

    it("lets only one update succeed for the same expected version", async () => {
      const row = await makeRequest();
      const outcomes = await Promise.all([
        store.tx((tx) => tx.updateRequest(row.id, { guidance: "first" }, row.version)),
        store.tx((tx) => tx.updateRequest(row.id, { guidance: "second" }, row.version)),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      await store.tx(async (tx) => {
        expect(await tx.getRequest(row.id)).toMatchObject({
          version: row.version + 1, guidance: outcomes[0] ? "first" : "second",
        });
      });
    });

    it("claims jobs once across workers and increments the attempt on retry", async () => {
      const row = await makeRequest();
      const base: WakeJob = {
        id: randomUUID(), requestId: row.id, requestVersion: row.version, audience: "recipient", attempt: 1, runAt: now,
        state: "queued",
      };
      const later = new Date(now.getTime() + 10_000);
      const leaseUntil = new Date(now.getTime() + 60_000);
      await store.tx(async (tx) => {
        await tx.enqueueWake(base);
        await tx.enqueueWake({ ...base, id: randomUUID(), runAt: later });
      });
      const claimed = (await Promise.all([
        store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 10)),
        store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 10)),
      ])).flat();
      expect(claimed).toMatchObject([{ id: base.id, state: "running", attempt: 1 }]);
      await store.tx(async (tx) => {
        expect(await tx.recordWakeAttempt(claimed[0]!, now, { ok: false, retryable: true, ms: 1 }, later)).toBe(true);
        expect(await tx.claimDueWakes(now, leaseUntil, 10)).toEqual([]);
        const retried = await tx.claimDueWakes(later, leaseUntil, 10);
        expect(retried).toHaveLength(2);
        const retry = retried.find(({ id }) => id === base.id)!;
        expect(retry).toMatchObject({ attempt: 2, recovered: false });
        expect(await tx.recordWakeAttempt(retry, later, { ok: true, retryable: false, ms: 1 }, null)).toBe(true);
        expect(await tx.claimDueWakes(later, leaseUntil, 10)).toEqual([]);
      });
    });

    it("keeps a request's origin channel and a notice's audience", async () => {
      const row = await makeRequest({ originChannel: "whatsapp" });
      const id = randomUUID();
      await store.tx((tx) => tx.enqueueWake({
        id, requestId: row.id, requestVersion: row.version + 1, audience: "origin", attempt: 1, runAt: now, state: "queued",
      }));
      await store.tx(async (tx) => {
        expect(await tx.getRequest(row.id)).toMatchObject({ originChannel: "whatsapp" });
        expect(await tx.getWakeForUpdate(row.id, row.version + 1)).toMatchObject({ id, audience: "origin" });
      });
      const plain = await makeRequest();
      await store.tx(async (tx) => expect((await tx.getRequest(plain.id))?.originChannel).toBeUndefined());
    });

    it("stores one channel per owner and name, and replaces its wake target", async () => {
      const webhook = { kind: "standard_webhook", url: "https://example.org/wake", secret: "whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQ=" } as const;
      await store.tx(async (tx) => {
        expect(await tx.getChannel("alice", "whatsapp")).toBeNull();
        await tx.putChannel({ userId: "carla", name: "whatsapp", wakeTarget: { kind: "none" }, createdAt: now });
        await tx.putChannel({ userId: "carla", name: "whatsapp", wakeTarget: webhook, createdAt: now });
      });
      await store.tx(async (tx) => {
        expect(await tx.getChannel("carla", "whatsapp")).toEqual({ userId: "carla", name: "whatsapp", wakeTarget: webhook, createdAt: now });
        expect(await tx.getUser("carla")).toMatchObject({ userId: "carla" });
      });
    });

    it("recovers expired leases and rejects late results from the previous attempt", async () => {
      const row = await makeRequest();
      const id = randomUUID();
      const leaseUntil = new Date(now.getTime() + 60_000);
      const result = { ok: true, retryable: false, ms: 1 };
      const [first] = await store.tx(async (tx) => {
        await tx.enqueueWake({
          id, requestId: row.id, requestVersion: row.version, audience: "recipient", attempt: 1, runAt: now, state: "queued",
        });
        return tx.claimDueWakes(now, leaseUntil, 10);
      });
      expect(first).toMatchObject({ id, leaseUntil, attempt: 1, recovered: false });
      await store.tx(async (tx) => {
        const extended = new Date(leaseUntil.getTime() + 60_000);
        expect(await tx.recordWakeAttempt(first!, leaseUntil, result, null)).toBe(false);
        const [second] = await tx.claimDueWakes(leaseUntil, extended, 10);
        expect(second).toMatchObject({ id, leaseUntil: extended, attempt: 2, recovered: true });
        expect(await tx.recordWakeAttempt(first!, leaseUntil, result, null)).toBe(false);
        expect(await tx.recordWakeAttempt(second!, leaseUntil, result, null)).toBe(true);
        expect(await tx.claimDueWakes(extended, extended, 10)).toEqual([]);
      });
    });

    it("registers agents idempotently across concurrent calls and preserves configured or revoked rows", async () => {
      const base: AgentConnectionRow = { userId: "carla", agentId: "bot", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now };
      let inserts = 0;
      const created = await Promise.all([
        store.tx((tx) => tx.ensureAgentConnection(base, () => inserts++)),
        store.tx((tx) => tx.ensureAgentConnection(base, () => inserts++)),
      ]);
      expect(created).toMatchObject([base, base]);
      // Only the call that inserted the row reports it (broker.agent.connected).
      expect(inserts).toBe(1);
      await store.tx(async (tx) => {
        const configured: AgentConnectionRow = {
          ...base, wakeTarget: { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_test" },
          revokedAt: now,
        };
        await tx.upsertAgentConnection(configured);
        expect(await tx.ensureAgentConnection(base)).toMatchObject(configured);
        expect(await tx.listAgentConnections("carla")).toMatchObject([configured]);
        expect(await tx.getAgentConnection("bruno", "bot", true)).toBeNull();
      });
    });

    it("revive una conexión revocada sin devolverle el canal push ni la verificación", async () => {
      const revoked: AgentConnectionRow = {
        userId: "carla", agentId: "bot", label: "Bot", createdAt: now, revokedAt: now, revokedBy: "owner",
        wakeTarget: { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_test" },
        verifiedAt: now, lastWakeAt: now,
      };
      const revived: AgentConnectionRow = {
        userId: "carla", agentId: "bot", label: "Bot", createdAt: now, wakeTarget: { kind: "none" }, lastWakeAt: now,
      };
      await store.tx(async (tx) => {
        await tx.upsertAgentConnection(revoked);
        const locked = await tx.ensureAgentConnection({ ...revoked, revokedAt: undefined });
        expect(locked).toEqual(revoked);
        // El titular revocó este canal: la conexión vuelve sin él, sin verificación y sin revocación.
        expect(await tx.reviveAgentConnection(locked)).toEqual(revived);
      });
      await store.tx(async (tx) => {
        expect(await tx.getAgentConnection("carla", "bot")).toEqual(revived);
      });
    });

    it("no revive la conexión que revocó el admin: esa revocación es terminal", async () => {
      const revoked: AgentConnectionRow = {
        userId: "carla", agentId: "bot", label: "Bot", createdAt: now,
        wakeTarget: { kind: "none" }, revokedAt: now, revokedBy: "admin",
      };
      await store.tx((tx) => tx.upsertAgentConnection(revoked));
      await expect(store.tx(async (tx) => {
        const locked = await tx.ensureAgentConnection({ ...revoked, revokedAt: undefined, revokedBy: undefined });
        return tx.reviveAgentConnection(locked);
      })).rejects.toMatchObject({ code: "not_found" });
      await store.tx(async (tx) => {
        expect(await tx.getAgentConnection("carla", "bot")).toEqual(revoked);
      });
    });

    it("no revive una conexión revocada si su titular ya tiene otra viva", async () => {
      const base: AgentConnectionRow = { userId: "carla", agentId: "old", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now };
      await store.tx(async (tx) => {
        await tx.upsertAgentConnection({ ...base, revokedAt: now });
        await tx.ensureAgentConnection({ ...base, agentId: "new" });
      });
      await expect(store.tx(async (tx) => {
        const locked = await tx.getAgentConnection("carla", "old", true);
        return tx.reviveAgentConnection(locked!);
      })).rejects.toMatchObject({ code: "conflict" });
      await store.tx(async (tx) => {
        expect(await tx.getAgentConnection("carla", "old")).toMatchObject({ revokedAt: now });
        expect((await tx.getAgentConnection("carla", "new"))?.revokedAt).toBeUndefined();
      });
    });

    it("guarda una conexión y un canal de sondeo sin secreto y los devuelve sin campos extra", async () => {
      const polling = { kind: "polling" } as const;
      await store.tx(async (tx) => {
        await tx.ensureAgentConnection({ userId: "carla", agentId: "cli", label: "CLI", wakeTarget: polling, createdAt: now });
        await tx.putChannel({ userId: "carla", name: "whatsapp", wakeTarget: polling, createdAt: now });
      });
      await store.tx(async (tx) => {
        const connection = await tx.getAgentConnection("carla", "cli");
        expect(connection).toMatchObject({ agentId: "cli", label: "CLI" });
        // Nadie le escribe: la conexión vuelve sin secreto ni ningún otro campo.
        expect(connection?.wakeTarget).toEqual(polling);
        expect(Object.keys(connection?.wakeTarget ?? {})).toEqual(["kind"]);
        expect((await tx.getChannel("carla", "whatsapp"))?.wakeTarget).toEqual(polling);
      });
    });

    it("promueve a sondeo una conexión ya bloqueada sin perder sus otros campos", async () => {
      // markPolling escribe desde dentro de la transacción que ya tomó el row lock en ensureAgentConnection
      // (en Postgres, SELECT … FOR UPDATE). Ningún otro caso del contrato actualiza una fila existente a "polling".
      const row: AgentConnectionRow = {
        userId: "carla", agentId: "cli", label: "CLI", wakeTarget: { kind: "none" },
        verifiedAt: now, lastWakeAt: now, createdAt: now,
      };
      const promoted: AgentConnectionRow = { ...row, wakeTarget: { kind: "polling" } };
      await store.tx(async (tx) => {
        const locked = await tx.ensureAgentConnection(row);
        expect(locked).toEqual(row);
        await tx.upsertAgentConnection({ ...locked, wakeTarget: { kind: "polling" } });
        // Sólo cambia el canal: etiqueta, fechas y revocación quedan como estaban.
        expect(await tx.getAgentConnection("carla", "cli")).toEqual(promoted);
      });
      await store.tx(async (tx) => {
        const reread = await tx.getAgentConnection("carla", "cli");
        expect(reread).toEqual(promoted);
        // Nadie le escribe: el canal vuelve sin secreto ni ningún otro campo.
        expect(Object.keys(reread?.wakeTarget ?? {})).toEqual(["kind"]);
      });
    });

    it("only lets one of two different agents claim the same owner concurrently", async () => {
      const base: AgentConnectionRow = { userId: "alice", agentId: "a", label: "Bot", createdAt: now, wakeTarget: { kind: "none" } };
      const outcomes = await Promise.allSettled(["a", "b"].map(agentId =>
        store.tx(tx => tx.ensureAgentConnection({ ...base, agentId }))));
      expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes).toContainEqual({ status: "rejected", reason: expect.objectContaining({ code: "conflict" }) });
      expect(await store.tx(tx => tx.listAgentConnections("alice"))).toHaveLength(1);
    });

    it("keeps one live grant per grantor, grantee and category, and hides revoked grants", async () => {
      const grant: GrantRow = {
        id: randomUUID(), grantorUserId: "bruno", granteeAddress: fromAddress,
        category: "availability", createdAt: now,
      };
      await store.tx(async (tx) => {
        expect(await tx.putGrant(grant)).toEqual(grant);
        expect(await tx.putGrant({ ...grant, id: randomUUID() })).toEqual(grant);
        expect(await tx.listGrants("bruno")).toEqual([grant]);
        expect(await tx.getGrant("bruno", fromAddress, "general")).toBeNull();
        expect(await tx.getGrant("alice", fromAddress, "availability")).toBeNull();

        expect(await tx.revokeGrant(grant.id, "alice", now)).toBe(false);
        expect(await tx.revokeGrant(grant.id, "bruno", now)).toBe(true);
        expect(await tx.revokeGrant(grant.id, "bruno", now)).toBe(false);
        expect(await tx.getGrant("bruno", fromAddress, "availability")).toBeNull();

        const again = { ...grant, id: randomUUID() };
        expect(await tx.putGrant(again)).toEqual(again);
        expect(await tx.listGrants("bruno")).toEqual([again]);
      });
    });

    it("lists an owner's agents by creation time and breaks ties by agent ID", async () => {
      await store.tx(async (tx) => {
        const agent = { userId: "alice", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now, revokedAt: now } as const;
        await tx.ensureAgentConnection({ ...agent, agentId: "z" });
        await tx.ensureAgentConnection({ ...agent, agentId: "A" });
        await tx.ensureAgentConnection({ ...agent, agentId: "a" });
        await tx.ensureAgentConnection({ ...agent, agentId: "newer", createdAt: new Date(now.getTime() + 1) });
        await tx.ensureAgentConnection({ ...agent, agentId: "older", createdAt: new Date(now.getTime() - 1) });
        await tx.ensureAgentConnection({ ...agent, agentId: "other", userId: "bruno" });
        expect((await tx.listAgentConnections("alice")).map(({ agentId }) => agentId))
          .toEqual(["older", "A", "a", "z", "newer"]);
      });
    });

    it("conserva el círculo original si se repite su id", async () => {
      const circle = { id: randomUUID(), ownerUserId: "alice", name: "Fútbol", createdAt: now };
      await store.tx((tx) => tx.insertCircle(circle));
      await expect(store.tx((tx) => tx.insertCircle({ ...circle, name: "Otro" }))).rejects.toMatchObject({ code: "conflict" });
      expect(await store.tx((tx) => tx.getCircle(circle.id))).toEqual(circle);
    });

    it("shares a circle only between addresses that joined it", async () => {
      const circle = { id: randomUUID(), ownerUserId: "alice", name: "Fútbol", createdAt: now };
      await store.tx(async (tx) => {
        await tx.insertCircle(circle);
        await tx.inviteCircleMember(circle.id, fromAddress);
        await tx.inviteCircleMember(circle.id, toAddress);
        expect(await tx.joinCircle(circle.id, fromAddress, now)).toBe(true);
        expect(await tx.joinCircle(circle.id, fromAddress, now)).toBe(false);
        expect(await tx.joinCircle(circle.id, "carla@sideband.app", now)).toBe(false);
        expect(await tx.shareCircle(fromAddress, toAddress)).toBe(false);
        expect(await tx.listCircles(toAddress)).toEqual([circle]);

        await tx.inviteCircleMember(circle.id, fromAddress);
        expect(await tx.joinCircle(circle.id, toAddress, now)).toBe(true);
        expect(await tx.shareCircle(toAddress, fromAddress)).toBe(true);
        expect(await tx.listCircleMembers(circle.id)).toEqual([
          { circleId: circle.id, address: fromAddress, joinedAt: now },
          { circleId: circle.id, address: toAddress, joinedAt: now },
        ]);

        expect(await tx.removeCircleMember(circle.id, toAddress)).toBe(true);
        expect(await tx.removeCircleMember(circle.id, toAddress)).toBe(false);
        expect(await tx.shareCircle(fromAddress, toAddress)).toBe(false);
        await tx.deleteCircle(circle.id);
        expect(await tx.getCircle(circle.id)).toBeNull();
        expect(await tx.listCircles(fromAddress)).toEqual([]);
      });
    });
  });
}
