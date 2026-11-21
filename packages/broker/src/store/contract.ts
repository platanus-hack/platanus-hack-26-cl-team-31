import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultVaultCategories, type VaultResult } from "@team-31/protocol";
import type { AgentConnectionRow, GrantRow, RequestRow, Store, WakeJob } from "./store.js";

// Every holder starts with the default categories. Most tests look only at the ones they create.
function created<T extends { id: string }>(categories: T[]): T[] {
  return categories.filter(category => !defaultVaultCategories.some(d => d.id === category.id));
}

// What the shared listing lets a reader open, without the flags every listed category carries.
function readable(result: VaultResult) {
  return result.categories.filter(c => c.canRead).map(({ canRead: _canRead, visibility: _visibility, ...category }) => category);
}

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

    it("seeds default tags once and isolates two owners' tags for the same contact", async () => {
      const custom = randomUUID();
      await store.tx(async (tx) => {
        for (const user of ["alice", "bruno"]) {
          expect((await tx.listTags(user)).map((tag) => tag.id)).toEqual(["friend", "family", "work"]);
          await tx.addContact(user, "carla@sideband.app");
          expect(await tx.setContactTags(user, "carla@sideband.app", ["family", "friend"])).toBe(true);
        }
        await tx.putTag("alice", { id: "family", name: "Familia", color: "amber", categories: ["general"] });
        await tx.putTag("bruno", { id: custom, name: "Vecinos", color: "sky", categories: ["interests"] });
        await expect(tx.putTag("bruno", { id: randomUUID(), name: "vecinos", color: "rose", categories: [] }))
          .rejects.toMatchObject({ code: "conflict" });
      });
      expect(await store.tx((tx) => tx.setContactTags("alice", "carla@sideband.app", [custom]))).toBe(false);
      await store.tx(async (tx) => {
        await tx.setContactTags("alice", "carla@sideband.app", []);
        expect(await tx.deleteTag("alice", "work")).toBe(true);
        expect(await tx.deleteTag("alice", "work")).toBe(false);
        expect(await tx.deleteTag("bruno", "friend")).toBe(true);
      });
      await store.tx(async (tx) => {
        expect((await tx.listContactTags("alice")).has("carla@sideband.app")).toBe(false);
        expect((await tx.listContactTags("bruno")).get("carla@sideband.app")).toEqual(["family"]);
        expect(await tx.listTags("alice")).toEqual([
          { id: "friend", name: "Amigo", color: "emerald", categories: ["availability", "interests"] },
          { id: "family", name: "Familia", color: "amber", categories: ["general"] },
        ]);
        expect((await tx.listTags("bruno")).map((tag) => tag.id)).toEqual(["family", "work", custom]);
        expect((await tx.listContacts("bruno"))[0]?.tags).toEqual(["family"]);
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
        await tx.listTags("alice");
        await tx.setContactTags("alice", toAddress, ["family"]);
        await tx.putGrant(grantTo(toAddress));
        await tx.putGrant({ ...grantTo(toAddress), category: "availability" });
        await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "bruno", category: "interests" });
        const revoked = await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "bruno" });
        await tx.revokeGrant(revoked.id, "bruno", now);
        await tx.putGrant({ ...grantTo(carla), grantorUserId: "bruno", category: "health" });
        await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "carla", category: "health" });
        expect(await tx.listContacts("alice")).toEqual([{
          address: toAddress, tags: ["family"], gives: ["availability", "general"], receives: ["interests"],
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
        await tx.listTags("alice");
        await tx.changeVault("alice", second, { action: "set_tag", categoryId: second, tagId: "family", allowed: true });
        await tx.changeVault("alice", second, { action: "set_tag", categoryId: second, tagId: "friend", allowed: true });

        expect(created((await tx.vaultCatalog("alice")).categories)).toEqual([
          { id: first, name: "Agenda", visibility: "private", tags: [] },
          { id: second, name: "Salud", visibility: "private", tags: ["family", "friend"] },
        ]);
        expect(created((await tx.ownerVault("alice")).categories)).toEqual([
          { id: first, name: "Agenda", visibility: "private", entries: [{ label: "Días", value: 2 }], tags: [], members: [] },
          { id: second, name: "Salud", visibility: "private", entries: [], tags: ["family", "friend"], members: [] },
        ]);
      });
    });

    it("starts each holder with the default categories and keeps a description per category", async () => {
      const id = randomUUID();
      const description = "Regalos que me gustaría recibir.";
      await store.tx(async tx => {
        const defaults = (await tx.vaultCatalog("bruno")).categories;
        expect(defaults.map(c => c.id).sort()).toEqual(defaultVaultCategories.map(c => c.id).sort());
        expect(defaults.find(c => c.id === "health")).toEqual({ ...defaultVaultCategories.find(c => c.id === "health"), visibility: "private", tags: [] });
        await tx.changeVault("bruno", id, { action: "create", name: "Deseos" });
        expect(await tx.changeVault("alice", id, { action: "describe", categoryId: id, description })).toBe(false);
        await tx.changeVault("bruno", id, { action: "describe", categoryId: id, description });
        expect(created((await tx.vaultCatalog("bruno")).categories)).toEqual([{ id, name: "Deseos", description, visibility: "private", tags: [] }]);
        await tx.addContact("bruno", fromAddress);
        await tx.changeVault("bruno", id, { action: "set_member", categoryId: id, address: fromAddress, allowed: true });
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([{ id, name: "Deseos", description }]);
        expect((await tx.sharedVault(fromAddress, toAddress, id)).categories).toEqual([{ id, name: "Deseos", description, visibility: "private", canRead: true, entries: [] }]);
        await tx.changeVault("bruno", id, { action: "describe", categoryId: id, description: "" });
        expect(created((await tx.ownerVault("bruno")).categories)).toEqual([{ id, name: "Deseos", visibility: "private", entries: [], tags: [], members: [fromAddress] }]);
        await tx.changeVault("bruno", "health", { action: "delete", categoryId: "health" });
        expect((await tx.vaultCatalog("bruno")).categories.map(c => c.id)).not.toContain("health");
      });
    });

    it("lets whoever holds a live grant read the default category of the same id", async () => {
      const entries = [{ label: "Lunes", value: "Libre desde las 18:00" }];
      await store.tx(async tx => {
        await tx.changeVault("bruno", "availability", { action: "put_entry", categoryId: "availability", ...entries[0]! });
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);

        const grant = await tx.putGrant({ ...grantTo(fromAddress), grantorUserId: "bruno", category: "availability" });
        expect(readable(await tx.sharedVault(fromAddress, toAddress)).map(c => c.id)).toEqual(["availability"]);
        expect((await tx.sharedVault(fromAddress, toAddress, "availability")).categories[0]?.entries).toEqual(entries);
        // The roster lists contacts only.
        expect(await tx.vaultMembers("bruno", "availability")).toEqual([]);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.vaultMembers("bruno", "availability")).toEqual([fromAddress]);

        // The holder's decision about the contact still wins over the grant.
        await tx.changeVault("bruno", "availability", { action: "set_member", categoryId: "availability", address: fromAddress, allowed: false });
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);
        await tx.changeVault("bruno", "availability", { action: "set_member", categoryId: "availability", address: fromAddress, allowed: true });
        await tx.revokeGrant(grant.id, "bruno", now);
        expect(readable(await tx.sharedVault(fromAddress, toAddress)).map(c => c.id)).toEqual(["availability"]);
        await tx.removeContact("bruno", fromAddress);
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);
      });
    });

    it("lists every category to any reader and lets any Sideband user open a public one", async () => {
      const id = randomUUID();
      const stranger = "eva@sideband.app";
      const listed = { id, name: "Viajes", visibility: "public", canRead: true };
      const entries = [{ label: "Destino", value: "Chiloé" }];
      await store.tx(async tx => {
        await tx.changeVault("bruno", id, { action: "create", name: "Viajes" });
        await tx.changeVault("bruno", id, { action: "put_entry", categoryId: id, label: "Destino", value: "Chiloé" });
        const catalog = (await tx.sharedVault(stranger, toAddress)).categories;
        expect(catalog.map(c => c.id).sort()).toEqual([...defaultVaultCategories.map(c => c.id), id].sort());
        expect(catalog.every(c => c.visibility === "private" && !c.canRead && !c.entries)).toBe(true);
        expect(await tx.sharedVault(stranger, toAddress, id)).toEqual({ categories: [] });
        expect(await tx.changeVault("alice", id, { action: "set_visibility", categoryId: id, visibility: "public" })).toBe(false);

        await tx.changeVault("bruno", id, { action: "set_visibility", categoryId: id, visibility: "public" });
        expect(created((await tx.sharedVault(stranger, toAddress)).categories)).toEqual([listed]);
        expect((await tx.sharedVault(stranger, toAddress, id)).categories).toEqual([{ ...listed, entries }]);
        expect(created((await tx.vaultCatalog("bruno")).categories)).toEqual([{ id, name: "Viajes", visibility: "public", tags: [] }]);
        // The other categories of the holder stay closed to the same reader.
        expect(readable(await tx.sharedVault(stranger, toAddress))).toEqual([{ id, name: "Viajes" }]);
        expect(await tx.sharedVault(stranger, toAddress, "health")).toEqual({ categories: [] });

        // The holder can still close a public category to one contact.
        await tx.addContact("bruno", fromAddress);
        expect(await tx.vaultMembers("bruno", id)).toEqual([fromAddress]);
        await tx.changeVault("bruno", id, { action: "set_member", categoryId: id, address: fromAddress, allowed: false });
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        expect(await tx.vaultMembers("bruno", id)).toEqual([]);

        // Back to private, only the contact with an individual permission reads it.
        await tx.changeVault("bruno", id, { action: "set_member", categoryId: id, address: fromAddress, allowed: true });
        await tx.changeVault("bruno", id, { action: "set_visibility", categoryId: id, visibility: "private" });
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([{ id, name: "Viajes" }]);
        expect(readable(await tx.sharedVault(stranger, toAddress))).toEqual([]);
        expect(await tx.sharedVault(stranger, toAddress, id)).toEqual({ categories: [] });
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
        expect(created((await tx.ownerVault("bruno")).categories)[0]?.members).toEqual([fromAddress]);
        expect((await tx.sharedVault(fromAddress, toAddress, categoryId)).categories).toHaveLength(1);
        await tx.listTags("bruno");
        await tx.setContactTags("bruno", fromAddress, ["family"]);
        await tx.changeVault("bruno", categoryId, { action: "set_tag", categoryId, tagId: "family", allowed: true });
        await tx.changeVault("bruno", categoryId, { ...member, allowed: false });
        expect(created((await tx.ownerVault("bruno")).categories)[0]?.members).toEqual([]);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([]);
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        await tx.changeVault("bruno", categoryId, member);
        await tx.removeContact("bruno", fromAddress);
        await tx.setContactTags("bruno", fromAddress, []);
        await tx.addContact("bruno", fromAddress);
        expect(await tx.vaultMembers("bruno", categoryId)).toEqual([]);
      });
    });

    it("filters vault entries by the owner's current tag and accepted contact before reading", async () => {
      const id = randomUUID();
      await store.tx(async tx => {
        await tx.changeVault("bruno", id, { action: "create", name: "Necesidades" });
        await tx.changeVault("bruno", id, { action: "put_entry", categoryId: id, label: "Sábado", value: "Taladro" });
        await tx.listTags("bruno");
        await tx.changeVault("bruno", id, { action: "set_tag", categoryId: id, tagId: "family", allowed: true });
        await tx.setContactTags("bruno", fromAddress, ["family"]);
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.addContact("bruno", fromAddress);
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([{ id, name: "Necesidades" }]);
        expect((await tx.sharedVault(fromAddress, toAddress, id)).categories[0]?.entries).toEqual([{ label: "Sábado", value: "Taladro" }]);
        expect(await tx.changeVault("alice", id, { action: "delete", categoryId: id })).toBe(false);
        await tx.setContactTags("bruno", fromAddress, ["work"]);
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.changeVault("bruno", id, { action: "delete", categoryId: id });
        expect(created((await tx.ownerVault("bruno")).categories)).toEqual([]);
      });
    });

    it("grants vault access through any of a contact's custom tags and drops it with the tag", async () => {
      const categoryId = randomUUID();
      const tagId = randomUUID();
      await store.tx(async tx => {
        const share = { action: "set_tag", categoryId, tagId, allowed: true } as const;
        await tx.listTags("bruno");
        await tx.putTag("bruno", { id: tagId, name: "Instituciones", color: "slate", categories: [] });
        await tx.changeVault("bruno", categoryId, { action: "create", name: "Privada" });
        await tx.changeVault("bruno", categoryId, { action: "put_entry", categoryId, label: "Dato", value: "Prueba" });
        expect(await tx.setContactTags("bruno", fromAddress, ["work", tagId])).toBe(true);
        expect(await tx.changeVault("bruno", categoryId, share)).toBe(true);
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        await tx.addContact("bruno", fromAddress);
        expect(created((await tx.ownerVault("bruno")).categories)[0]?.members).toEqual([fromAddress]);
        expect(created((await tx.vaultCatalog("bruno")).categories)).toEqual([{ id: categoryId, name: "Privada", visibility: "private", tags: [tagId] }]);
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([{ id: categoryId, name: "Privada" }]);
        expect((await tx.sharedVault(fromAddress, toAddress, categoryId)).categories[0]?.entries).toEqual([{ label: "Dato", value: "Prueba" }]);
        expect(await tx.sharedVault("eva@sideband.app", toAddress, categoryId)).toEqual({ categories: [] });
        await tx.setContactTags("bruno", fromAddress, ["work"]);
        expect(readable(await tx.sharedVault(fromAddress, toAddress))).toEqual([]);
        await tx.setContactTags("bruno", fromAddress, [tagId]);
        expect(await tx.deleteTag("bruno", tagId)).toBe(true);
        expect(created((await tx.vaultCatalog("bruno")).categories)[0]?.tags).toEqual([]);
        expect(await tx.listContactTags("bruno")).toEqual(new Map());
        expect(await tx.sharedVault(fromAddress, toAddress, categoryId)).toEqual({ categories: [] });
        expect(created((await tx.ownerVault("bruno")).categories)[0]).toMatchObject({ entries: [{ label: "Dato", value: "Prueba" }], tags: [] });
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
