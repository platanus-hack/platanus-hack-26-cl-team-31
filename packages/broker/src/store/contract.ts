import { randomUUID } from "node:crypto";
import { SharingRules } from "@team-31/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentConnectionRow, RequestRow, Store, WakeJob } from "./store.js";

// makeStore supplies an isolated store per test, including an empty wake queue.
export function runStoreContractTests(makeStore: () => Store | Promise<Store>): void {
  const now = new Date("2026-11-21T15:00:00Z");
  const rules = SharingRules.parse({ circles: {}, grants: {} });
  const fromAddress = "alice@nexo.app";
  const toAddress = "bruno@nexo.app";
  let store: Store;

  async function makeRequest(overrides: Partial<RequestRow> = {}): Promise<RequestRow> {
    const row: RequestRow = {
      id: randomUUID(), fromUserId: "alice", toUserId: "bruno", fromAddress, toAddress,
      tool: "question", args: { text: "Hola" }, status: "awaiting_agent", allowedFields: ["answer"],
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

    it("rolls back addresses, rules, requests and their events when a transaction rejects", async () => {
      const row = await makeRequest();
      await expect(store.tx(async (tx) => {
        await tx.createAddress("carla", "carla@nexo.app");
        await tx.putRules("alice", rules);
        await tx.updateRequest(row.id, { status: "awaiting_owner" }, row.version);
        await tx.appendEvent({ requestId: row.id, at: now, kind: "permission" });
        throw new Error("rollback");
      })).rejects.toThrow("rollback");

      await store.tx(async (tx) => {
        expect(await tx.getUser("carla")).toBeNull();
        expect(await tx.getRules("alice")).toBeNull();
        expect(await tx.getRequest(row.id)).toMatchObject({ status: "awaiting_agent", version: 0 });
        expect(await tx.listEvents([row.id])).toEqual([]);
      });
    });

    it("allows one address per user and one user per address", async () => {
      await expect(store.tx((tx) => tx.createAddress("carla", fromAddress))).rejects.toMatchObject({ code: "conflict" });
      await expect(store.tx((tx) => tx.createAddress("alice", "other@nexo.app"))).rejects.toMatchObject({ code: "conflict" });
      await store.tx(async (tx) => {
        await tx.putRules("carla", rules);
        expect(await tx.getUser("carla")).toMatchObject({ userId: "carla" });
        await tx.createAddress("carla", "carla@nexo.app");
        expect(await tx.getRules("carla")).toEqual(rules);
        expect(await tx.getUserByAddress("carla@nexo.app")).toMatchObject({ userId: "carla" });
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
        expect(await tx.listActivity("someone@nexo.app", 10)).toEqual([]);
        expect((await tx.listActivity(fromAddress, 10)).map(({ id }) => id)).toEqual(expect.arrayContaining([inbox.id, pending.id, final.id]));
        expect((await tx.listActivity(fromAddress, 1))).toHaveLength(1);
        expect((await tx.listDueForExpiry(now, 10)).map(({ id }) => id)).toEqual(expect.arrayContaining([inbox.id, pending.id]));
        expect((await tx.listDueForExpiry(now, 10)).map(({ id }) => id)).not.toContain(final.id);
        expect(await tx.listEvents([])).toEqual([]);
        expect((await tx.listEvents([inbox.id])).map(({ kind }) => kind)).toEqual(["received", "permission"]);
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
        id: randomUUID(), requestId: row.id, requestVersion: row.version, attempt: 1, runAt: now, state: "queued",
      };
      const later = new Date(now.getTime() + 10_000);
      await store.tx(async (tx) => {
        await tx.enqueueWake(base);
        await tx.enqueueWake({ ...base, id: randomUUID(), runAt: later });
      });
      const claimed = (await Promise.all([
        store.tx((tx) => tx.claimDueWakes(now, 10)),
        store.tx((tx) => tx.claimDueWakes(now, 10)),
      ])).flat();
      expect(claimed).toMatchObject([{ id: base.id, state: "running", attempt: 1 }]);
      await store.tx(async (tx) => {
        await tx.completeWake(base.id, { ok: false, retryable: true, ms: 1 }, later);
        expect(await tx.claimDueWakes(now, 10)).toEqual([]);
        expect(await tx.claimDueWakes(later, 10)).toHaveLength(2);
        await tx.completeWake(base.id, { ok: true, retryable: false, ms: 1 }, null);
        expect(await tx.claimDueWakes(later, 10)).toEqual([]);
      });
    });

    it("registers agents idempotently across concurrent calls and preserves configured or revoked rows", async () => {
      const base: AgentConnectionRow = { userId: "carla", agentId: "bot", label: "Bot", wakeTarget: { kind: "none" }, createdAt: now };
      const created = await Promise.all([
        store.tx((tx) => tx.ensureAgentConnection(base)),
        store.tx((tx) => tx.ensureAgentConnection(base)),
      ]);
      expect(created).toMatchObject([base, base]);
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
  });
}
