import { readFile } from "node:fs/promises";
import { createTestDatabase, type TestDatabase } from "@team-31/test-db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresTurnStore } from "./postgres.js";
import type { TurnState, TurnSession } from "./types.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("turnos durables", () => {
  let db: TestDatabase;
  let store: ReturnType<typeof createPostgresTurnStore>;
  let replica: typeof store;
  const owner = { userId: "ana", binding: "test:link" };
  const draft: TurnState = { phase: "clarify", intent: { action: "clarify" }, field: "intent", at: "2026-11-21T14:00:00Z" };
  async function clarify(s: TurnSession) {
    await s.save(draft);
    return { kind: "clarification" as const, question: "¿A quién?", continuationId: s.continuationId };
  }
  beforeAll(async () => {
    db = await createTestDatabase("message_turns");
    const connection = db.pool();
    await connection.query("CREATE SCHEMA sideband");
    await connection.query(await readFile(new URL("../../broker/drizzle/0201_message_turns.sql", import.meta.url), "utf8"));
    store = createPostgresTurnStore(db.url);
    replica = createPostgresTurnStore(db.url);
  });
  afterAll(async () => {
    await Promise.all([store?.close(), replica?.close()]);
    await db?.drop();
  });

  it("guarda una sola aclaración por entrega entre réplicas y restringe la continuación a la identidad", async () => {
    const turn = vi.fn(clarify);
    const message = { ...owner, deliveryId: "first" };
    const [a, b] = await Promise.all([store.run(message, undefined, turn), replica.run(message, undefined, turn)]);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    if (a?.kind !== "clarification") throw new Error("Falta aclaración");
    expect(await replica.latestContinuation(owner.userId, owner.binding)).toBe(a.continuationId);
    for (const other of [{ ...owner, agentId: "otro" }, { ...owner, userId: "otra" }, { ...owner, binding: "otro" }]) {
      expect(await store.run(other, a.continuationId, turn)).toBeUndefined();
    }
    const continuation = { ...owner, deliveryId: "reply" };
    await expect(store.run(continuation, a.continuationId, async s => {
      expect(s.previous).toEqual(draft);
      throw new Error("temporary");
    })).rejects.toThrow("temporary");
    const confirmed = await replica.run(continuation, a.continuationId, async s => {
      expect(s.previous).toEqual(draft);
      return { kind: "profiles", items: [] };
    });
    expect(confirmed?.kind).toBe("profiles");
    expect(await store.run({ ...owner, deliveryId: "another-reply" }, a.continuationId, turn)).toBeUndefined();
    expect(await store.latestContinuation(owner.userId, owner.binding)).toBeUndefined();
  });

  it("reanuda el despacho interrumpido con el mismo id y el mismo conjunto", async () => {
    const binding = { ...owner, binding: "otro-vinculo", deliveryId: "interrupted" };
    const dispatch: TurnState = { phase: "dispatch", jobs: [], refs: [] };
    let original = "";
    await expect(store.run(binding, undefined, async s => {
      original = s.id;
      await s.save(dispatch);
      throw new Error("corte");
    })).rejects.toThrow("corte");
    await replica.run(binding, undefined, async s => {
      expect(s.previous).toEqual(dispatch);
      expect(s.id).toBe(original);
      await s.save({ phase: "requests", refs: [] });
      return { kind: "requests", items: [], unconfirmedCount: 0, continuationId: s.id };
    });
    await replica.run(binding, undefined, async s => {
      expect(s.replay).toBe(true);
      expect(s.previous).toEqual({ phase: "requests", refs: [] });
      return { kind: "requests", items: [], unconfirmedCount: 0, continuationId: s.id };
    });
    await db.pool().query("UPDATE sideband.message_turns SET expires_at = now() WHERE id = $1", [original]);
    expect(await store.run({ ...owner, binding: binding.binding }, original, clarify)).toBeUndefined();
  });
});
