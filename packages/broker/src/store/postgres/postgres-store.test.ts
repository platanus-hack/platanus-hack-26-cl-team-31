import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { WakeTarget } from "@team-31/protocol";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runStoreContractTests } from "../contract.js";
import type { RequestRow, WakeJob } from "../store.js";
import { applyPostgresMigrations, createPostgresStore, type PostgresStore } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
const secretsKey = Buffer.alloc(32, 42).toString("base64");
const now = new Date("2026-11-21T15:00:00.123Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!testDatabaseUrl)("Store del broker en Postgres", () => {
  const databaseName = "nexo_test_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool | undefined;
  let isolated: pg.Pool;
  let databaseUrl: string;
  let store: PostgresStore;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl);
    const devUrl = process.env.DATABASE_URL;
    if (!url.pathname.endsWith("_test") || (devUrl && url.pathname === new URL(devUrl).pathname)) {
      throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
    }
    // A dedicated test database isolates schema lifecycle tests from other packages' catalog queries.
    admin = new pg.Pool({ connectionString: testDatabaseUrl });
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
    url.pathname = "/" + databaseName;
    databaseUrl = url.toString();
    isolated = new pg.Pool({ connectionString: databaseUrl });
  });

  beforeEach(async () => {
    await isolated.query("DROP SCHEMA IF EXISTS nexo CASCADE");
    await applyPostgresMigrations({ databaseUrl });
    store = createPostgresStore({ databaseUrl, secretsKey });
  });

  afterEach(async () => { await store?.close(); });
  afterAll(async () => {
    try {
      await isolated?.end();
      await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
    } finally {
      await admin?.end();
    }
  });

  runStoreContractTests(() => store);

  async function makeRequest(overrides: Partial<RequestRow> = {}) {
    const row: RequestRow = {
      id: randomUUID(), fromUserId: "alice", toUserId: "bruno",
      fromAddress: "alice@nexo.app", toAddress: "bruno@nexo.app",
      tool: "question", args: { text: "Hola" }, status: "awaiting_agent", allowedFields: ["answer"],
      guidance: "", rule: "test", escalated: false, envelopeSignature: "envelope",
      createdAt: now, expiresAt: now, version: 0, ...overrides,
    };
    await store.tx((tx) => tx.insertRequest(row));
    return row;
  }

  async function createParticipants() {
    await store.tx(async (tx) => {
      await tx.createAddress("alice", "alice@nexo.app");
      await tx.createAddress("bruno", "bruno@nexo.app");
      await tx.createAddress("carla", "carla@nexo.app");
    });
  }

  it("filters lists on the participant ID as well as the claimed address", async () => {
    await createParticipants();
    const authorized = await makeRequest({ toAddress: "carla@nexo.app", toUserId: "carla" });
    const unmatched = await makeRequest({ toAddress: "carla@nexo.app" });
    const noRecipient = await makeRequest({ toAddress: "carla@nexo.app", toUserId: null, status: "awaiting_owner" });
    await store.tx(async (tx) => {
      expect(await tx.getRequest(unmatched.id, { toUserId: "carla" })).toBeNull();
      expect(await tx.getRequest(unmatched.id, { fromUserId: "alice", toUserId: "carla" })).toBeNull();
      expect(await tx.getRequest(noRecipient.id, { toUserId: "carla" })).toBeNull();
      expect((await tx.listInbox("carla@nexo.app")).map(({ id }) => id)).toEqual([authorized.id]);
      expect(await tx.listOwnerPending("carla@nexo.app")).toEqual([]);
      expect((await tx.listActivity("carla@nexo.app", 10)).map(({ id }) => id)).toEqual([authorized.id]);
    });
  });

  it("leaves the transaction usable after a handled address conflict", async () => {
    await createParticipants();
    await store.tx(async (tx) => {
      await expect(tx.createAddress("diego", "alice@nexo.app")).rejects.toMatchObject({ code: "conflict" });
      await tx.createAddress("diego", "diego@nexo.app");
    });
    expect(await store.tx((tx) => tx.getUserByAddress("diego@nexo.app"))).toMatchObject({ userId: "diego" });
  });

  it("distinguishes clearing an optional field from leaving it out of a CAS patch", async () => {
    await createParticipants();
    const row = await makeRequest({ purpose: "test", decisionReason: "pendiente" });
    await store.tx(async (tx) => {
      expect(await tx.updateRequest(row.id, { decisionReason: undefined }, 0)).toBe(true);
      expect(await tx.getRequest(row.id)).toMatchObject({ purpose: "test", decisionReason: undefined, version: 1 });
    });
  });

  it("skips a locked job while its claim transaction is still open", async () => {
    await createParticipants();
    const row = await makeRequest();
    const jobs: WakeJob[] = ["first", "second"].map((id) => ({
      id, requestId: row.id, requestVersion: row.version, attempt: 1, runAt: now, state: "queued",
    }));
    await store.tx(async (tx) => {
      for (const job of jobs) await tx.enqueueWake(job);
    });

    const claimed = deferred<WakeJob[]>();
    const release = deferred<void>();
    const first = store.tx(async (tx) => {
      claimed.resolve(await tx.claimDueWakes(now, 1));
      await release.promise;
    });
    const timeout = new AbortController();
    let second: Promise<WakeJob[]> | undefined;
    try {
      expect(await Promise.race([claimed.promise, first])).toMatchObject([{ id: "first", state: "running" }]);
      second = store.tx((tx) => tx.claimDueWakes(now, 1));
      expect(await Promise.race([
        second,
        delay(2_000, undefined, { signal: timeout.signal }).then(() => {
          throw new Error("The second transaction waited for a locked wake job.");
        }),
      ])).toMatchObject([{ id: "second", state: "running" }]);
    } finally {
      timeout.abort();
      release.resolve();
      await Promise.allSettled([first, second]);
    }
    expect(await store.tx((tx) => tx.claimDueWakes(now, 10))).toEqual([]);
  });

  it("encrypts each WakeTarget secret as bytea and restores it on read", async () => {
    const secret = "whsec_fixture-secret-value";
    const targets: WakeTarget[] = [
      { kind: "none" },
      { kind: "openclaw_hooks", baseUrl: "https://example.com", agentId: "bot", token: secret },
      { kind: "grokbot_routine", url: "https://example.com", key: secret },
      { kind: "standard_webhook", url: "https://example.com", secret },
      {
        kind: "mcp_events", callbackUrl: "https://example.com", secret,
        subscriptionId: "subscription", refreshBefore: null,
      },
    ];
    await store.tx(async (tx) => {
      for (const wakeTarget of targets) {
        await tx.upsertAgentConnection({ userId: "alice", agentId: wakeTarget.kind, label: "Bot", createdAt: now, wakeTarget });
      }
    });
    const { rows } = await isolated.query<{ wake_kind: string; wake_public: object; wake_secret: Buffer | null }>(
      "SELECT wake_kind, wake_public, wake_secret FROM nexo.agent_connections",
    );

    expect(rows).toHaveLength(targets.length);
    for (const raw of rows) {
      expect(raw.wake_public).not.toHaveProperty("token");
      expect(raw.wake_public).not.toHaveProperty("key");
      expect(raw.wake_public).not.toHaveProperty("secret");
      expect(JSON.stringify(raw.wake_public)).not.toContain(secret);
      if (raw.wake_kind === "none") {
        expect(raw.wake_secret).toBeNull();
      } else {
        expect(raw.wake_secret).toBeInstanceOf(Buffer);
        expect(raw.wake_secret?.includes(Buffer.from(secret))).toBe(false);
      }
    }
    const read = await store.tx((tx) => tx.listAgentConnections("alice"));
    expect(read.map(({ wakeTarget }) => wakeTarget)).toEqual(expect.arrayContaining(targets));

    const otherKey = createPostgresStore({ databaseUrl, secretsKey: Buffer.alloc(32, 43).toString("base64") });
    try {
      await expect(otherKey.tx((tx) => tx.getAgentConnection("alice", "standard_webhook")))
        .rejects.toMatchObject({ code: "internal" });
    } finally {
      await otherKey.close();
    }
  });

  it("serializes migration runs and preserves already stored data", async () => {
    // Exercise migration under contention on a fresh schema, then retry after writing data.
    await isolated.query("DROP SCHEMA nexo CASCADE");
    await Promise.all([
      applyPostgresMigrations({ databaseUrl }),
      applyPostgresMigrations({ databaseUrl }),
    ]);
    await createParticipants();
    const row = await makeRequest();
    await applyPostgresMigrations({ databaseUrl });
    expect(await store.tx((tx) => tx.getRequest(row.id))).toMatchObject({ id: row.id, version: 0 });
    const { rows } = await isolated.query("SELECT id FROM nexo.__drizzle_migrations");
    expect(rows).toHaveLength(1);
  });

  it("rolls back a migration that fails partway through its DDL", async () => {
    await isolated.query("DROP SCHEMA nexo CASCADE");
    await isolated.query("CREATE SCHEMA nexo");
    await isolated.query("CREATE TABLE nexo.users (existing_column int)");

    await expect(applyPostgresMigrations({ databaseUrl })).rejects.toThrow();
    const { rows: [rolledBack] } = await isolated.query(
      "SELECT to_regclass('nexo.agent_connections') AS agent_connections",
    );
    expect(rolledBack?.agent_connections).toBeNull();
    const { rows } = await isolated.query("SELECT id FROM nexo.__drizzle_migrations");
    expect(rows).toHaveLength(0);

    await isolated.query("DROP TABLE nexo.users");
    await applyPostgresMigrations({ databaseUrl });
    await createParticipants();
  });

  it("enforces the append-only audit trail with the local Postgres role", async () => {
    await createParticipants();
    const row = await makeRequest();
    await store.tx((tx) => tx.appendEvent({ requestId: row.id, at: now, kind: "received" }));
    for (const command of [
      "UPDATE nexo.request_events SET kind = 'delivery'",
      "DELETE FROM nexo.request_events",
      "TRUNCATE nexo.request_events",
    ]) {
      await expect(isolated.query(command)).rejects.toMatchObject({ code: "55000" });
    }
    expect(await store.tx((tx) => tx.listEvents([row.id]))).toMatchObject([{ kind: "received" }]);
  });

  it("grants a separate runtime role only the privileges needed by the Store", async () => {
    const runtimeRole = "nexo_test_" + randomUUID().replaceAll("-", "");
    await isolated.query(`CREATE ROLE ${pg.escapeIdentifier(runtimeRole)}`);
    try {
      await applyPostgresMigrations({ databaseUrl, runtimeRole });
      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.searchParams.set("options", "-c role=" + runtimeRole);
      const runtime = createPostgresStore({ databaseUrl: runtimeUrl.toString(), secretsKey });
      try {
        await createParticipants();
        const row = await makeRequest();
        await runtime.tx(async (tx) => {
          await tx.appendEvent({ requestId: row.id, at: now, kind: "received" });
          expect(await tx.listEvents([row.id])).toMatchObject([{ kind: "received" }]);
          expect(await tx.updateRequest(row.id, { guidance: "updated by runtime" }, row.version)).toBe(true);
        });
      } finally {
        await runtime.close();
      }
      const { rows: [privileges] } = await isolated.query(
        "SELECT has_table_privilege($1, 'nexo.request_events', 'UPDATE, DELETE, TRUNCATE') AS can_mutate",
        [runtimeRole],
      );
      expect(privileges?.can_mutate).toBe(false);
    } finally {
      await isolated.query(`DROP OWNED BY ${pg.escapeIdentifier(runtimeRole)}`);
      await isolated.query(`DROP ROLE ${pg.escapeIdentifier(runtimeRole)}`);
    }
  });
});
