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

    it("filters vault entries by the owner's current tag and accepted contact before reading", async () => {
      const id = randomUUID();
      await store.tx(async tx => {
        await tx.changeVault("bruno", id, { action: "create", name: "Necesidades" });
        await tx.changeVault("bruno", id, { action: "put_entry", categoryId: id, label: "Sábado", value: "Taladro" });
        await tx.changeVault("bruno", id, { action: "set_group", categoryId: id, group: "family", allowed: true });
        await tx.setContactTag("bruno", fromAddress, "family");
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.addFriend("bruno", fromAddress);
        expect(await tx.sharedVault(fromAddress, toAddress)).toEqual({ categories: [{ id, name: "Necesidades" }] });
        expect((await tx.sharedVault(fromAddress, toAddress, id)).categories[0]?.entries).toEqual([{ label: "Sábado", value: "Taladro" }]);
        expect(await tx.changeVault("alice", id, { action: "delete", categoryId: id })).toBe(false);
        await tx.setContactTag("bruno", fromAddress, "work");
        expect(await tx.sharedVault(fromAddress, toAddress, id)).toEqual({ categories: [] });
        await tx.changeVault("bruno", id, { action: "delete", categoryId: id });
        expect(await tx.ownerVault("bruno")).toEqual({ categories: [] });
      });
    });

    it("lists each active agent with an address and exposes only its public fields", async () => {
      await store.tx(async (tx) => {
        const agent = { userId: "alice", agentId: "client-1", label: "Alba", wakeTarget: { kind: "none" }, createdAt: now } as const;
        await tx.ensureAgentConnection(agent);
        await tx.ensureAgentConnection({ ...agent, agentId: "client-2", label: "Luna" });
        await tx.ensureAgentConnection({ ...agent, userId: "bruno" });
        await tx.ensureAgentConnection({ ...agent, userId: "addressless" });
        await tx.upsertAgentConnection({ ...agent, agentId: "old", revokedAt: now });
        expect(await tx.listPublicAgents()).toEqual([
          { agentId: "client-1", label: "Alba", address: fromAddress }, { agentId: "client-1", label: "Alba", address: toAddress },
          { agentId: "client-2", label: "Luna", address: fromAddress },
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
      expect(first).toMatchObject({ id, runAt: leaseUntil, attempt: 1, recovered: false });
      await store.tx(async (tx) => {
        const extended = new Date(leaseUntil.getTime() + 60_000);
        expect(await tx.recordWakeAttempt(first!, leaseUntil, result, null)).toBe(false);
        const [second] = await tx.claimDueWakes(leaseUntil, extended, 10);
        expect(second).toMatchObject({ id, runAt: extended, attempt: 2, recovered: true });
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
        const agent = { userId: "alice", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now } as const;
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
