import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Principal, WakeTarget } from "@team-31/protocol";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBroker, type BrokerDeps } from "../../index.js";
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
  const databaseName = "sideband_test_" + randomUUID().replaceAll("-", "");
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
    await isolated.query("DROP SCHEMA IF EXISTS sideband CASCADE");
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
      fromAddress: "alice@sideband.app", toAddress: "bruno@sideband.app",
      tool: "question", args: { text: "Hola", category: "general" }, status: "awaiting_agent", allowedFields: ["answer"],
      guidance: "", rule: "test", escalated: false, envelopeSignature: "envelope",
      createdAt: now, expiresAt: now, version: 0, ...overrides,
    };
    await store.tx((tx) => tx.insertRequest(row));
    return row;
  }

  async function createParticipants() {
    await store.tx(async (tx) => {
      await tx.createAddress("alice", "alice@sideband.app");
      await tx.createAddress("bruno", "bruno@sideband.app");
      await tx.createAddress("carla", "carla@sideband.app");
    });
  }

  it("delivers an agent reply after the owner approves once and the Store reopens", async () => {
    const alice: Principal = { userId: "alice", agentId: "alice-bot", scopes: ["sideband:ask", "sideband:status"] };
    const bruno: Principal = { userId: "bruno", agentId: "bruno-bot", scopes: ["sideband:inbox", "sideband:reply"] };
    const { privateKey } = generateKeyPairSync("ed25519");
    const deps: Omit<BrokerDeps, "store"> = {
      clock: { now: () => now },
      signingKey: privateKey,
      nonceKey: new Uint8Array(32).fill(4),
      waker: {
        async verifyCallback() { return { ok: true }; },
        async wake() { return { ok: true, retryable: false, ms: 1 }; },
      },
      config: { addressDomain: "sideband.app", requestTtlSeconds: 900, wakeRetryDelaysMs: [0] },
    };
    await createParticipants();
    const broker = createBroker({ ...deps, store });
    const grant = await broker.owner.setGrant(bruno, { grantee: "alice@sideband.app", category: "general" });
    const { requestId } = await broker.agent.ask(alice, {
      to: "bruno@sideband.app", tool: "question", args: { text: "¿Disponible?", category: "general" },
    });
    const [escalated] = await broker.agent.inbox(bruno);
    await broker.agent.reply(bruno, { requestId, nonce: escalated!.nonce, outcome: "needs_owner" });
    expect(await broker.agent.status(alice, requestId)).toMatchObject({ final: false, waitingFor: "owner" });
    await broker.owner.decide(bruno, requestId, { kind: "approve_once" });
    // The approval outlives the grant that let the request in.
    await broker.owner.revokeGrant(bruno, grant.id);

    await store.close();
    store = createPostgresStore({ databaseUrl, secretsKey });
    const reopened = createBroker({ ...deps, store });
    const [item] = await reopened.agent.inbox(bruno);
    expect(item).toMatchObject({ requestId, allowedFields: ["answer"] });
    const result = { answer: "Sí" };
    await expect(reopened.agent.reply(bruno, {
      requestId, nonce: item!.nonce, outcome: "answered", result,
    })).resolves.toMatchObject({ status: "answered", deliveredFields: ["answer"] });
    await expect(reopened.agent.status(alice, requestId)).resolves.toMatchObject({
      final: true, decision: "allow", result,
    });
  });

  it("filters lists on the participant ID as well as the claimed address", async () => {
    await createParticipants();
    const authorized = await makeRequest({ toAddress: "carla@sideband.app", toUserId: "carla" });
    const unmatched = await makeRequest({ toAddress: "carla@sideband.app" });
    const noRecipient = await makeRequest({ toAddress: "carla@sideband.app", toUserId: null, status: "awaiting_owner" });
    await store.tx(async (tx) => {
      expect(await tx.getRequest(unmatched.id, { toUserId: "carla" })).toBeNull();
      expect(await tx.getRequest(unmatched.id, { fromUserId: "alice", toUserId: "carla" })).toBeNull();
      expect(await tx.getRequest(noRecipient.id, { toUserId: "carla" })).toBeNull();
      expect((await tx.listInbox("carla@sideband.app")).map(({ id }) => id)).toEqual([authorized.id]);
      expect(await tx.listOwnerPending("carla@sideband.app")).toEqual([]);
      expect((await tx.listActivity("carla@sideband.app", 10)).map(({ id }) => id)).toEqual([authorized.id]);
    });
  });

  it("leaves the transaction usable after a handled address conflict", async () => {
    await createParticipants();
    await store.tx(async (tx) => {
      await expect(tx.createAddress("diego", "alice@sideband.app")).rejects.toMatchObject({ code: "conflict" });
      await tx.createAddress("diego", "diego@sideband.app");
    });
    expect(await store.tx((tx) => tx.getUserByAddress("diego@sideband.app"))).toMatchObject({ userId: "diego" });
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
    const leaseUntil = new Date(now.getTime() + 60_000);
    const jobs: WakeJob[] = ["first", "second"].map((id) => ({
      id, requestId: row.id, requestVersion: row.version, attempt: 1, runAt: now, state: "queued",
    }));
    await store.tx(async (tx) => {
      for (const job of jobs) await tx.enqueueWake(job);
    });

    const claimed = deferred<WakeJob[]>();
    const release = deferred<void>();
    const first = store.tx(async (tx) => {
      claimed.resolve(await tx.claimDueWakes(now, leaseUntil, 1));
      await release.promise;
    });
    const timeout = new AbortController();
    let second: Promise<WakeJob[]> | undefined;
    try {
      expect(await Promise.race([claimed.promise, first])).toMatchObject([{ id: "first", state: "running" }]);
      second = store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 1));
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
    expect(await store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 10))).toEqual([]);
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
      "SELECT wake_kind, wake_public, wake_secret FROM sideband.agent_connections",
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
    await isolated.query("DROP SCHEMA sideband CASCADE");
    await Promise.all([
      applyPostgresMigrations({ databaseUrl }),
      applyPostgresMigrations({ databaseUrl }),
    ]);
    await createParticipants();
    const row = await makeRequest();
    await applyPostgresMigrations({ databaseUrl });
    expect(await store.tx((tx) => tx.getRequest(row.id))).toMatchObject({ id: row.id, version: 0 });
    const { rows } = await isolated.query("SELECT id FROM sideband.__drizzle_migrations");
    expect(rows).toHaveLength(7);
  });

  it("reads a question stored before categories as an open question", async () => {
    await createParticipants();
    const row = await makeRequest({ args: { text: "Hola" } });
    expect((await store.tx((tx) => tx.getRequest(row.id)))?.args).toEqual({ text: "Hola", category: "general" });
  });

  it("moves tool grants and invitation offers to categories and deletes grants of a tool without one", async () => {
    await createParticipants();
    const invitation = await makeRequest({
      tool: "connect", args: { share: { availability: "slots", interests: false, questions: true } },
    });
    // Restore the grants table and the migration journal from before categories.
    await isolated.query("DROP INDEX sideband.grants_live_idx");
    await isolated.query(`ALTER TABLE sideband.grants DROP COLUMN category, ADD COLUMN tool text NOT NULL,
      ADD COLUMN fields text[] NOT NULL, ADD COLUMN friend_default boolean DEFAULT false NOT NULL`);
    await isolated.query(`CREATE UNIQUE INDEX grants_live_idx ON sideband.grants (grantor_user_id, grantee_address, tool)
      WHERE revoked_at IS NULL`);
    await isolated.query("DROP TABLE sideband.contact_tags, sideband.tag_presets");
    await isolated.query("DELETE FROM sideband.__drizzle_migrations WHERE id > 5");
    for (const [tool, field] of [["availability", "available"], ["interest_check", "matches"], ["question", "answer"], ["profile", "displayName"]]) {
      await isolated.query(
        `INSERT INTO sideband.grants (id, grantor_user_id, grantee_address, tool, fields, created_at)
         VALUES ($1, 'bruno', 'alice@sideband.app', $1, $2, $3)`,
        [tool, [field], now],
      );
    }

    await applyPostgresMigrations({ databaseUrl });

    const grants = await store.tx((tx) => tx.listGrants("bruno"));
    expect(Object.fromEntries(grants.map(({ id, category }) => [id, category]))).toEqual({
      availability: "availability", interest_check: "interests", question: "general",
    });
    expect((await store.tx((tx) => tx.getRequest(invitation.id)))?.args).toEqual({ share: ["availability", "general"] });
  });

  it("recovers only legacy one-time approvals with an audit event", async () => {
    await createParticipants();
    const rule = "Permiso del dueño por única vez";
    const approved = await makeRequest({ rule });
    const answered = await makeRequest({ rule, status: "answered", answeredByAgentId: "bruno-bot" });
    const noEvent = await makeRequest({ rule });
    const circleGrant = await makeRequest({ rule: "amigos pueden usar question: answer" });
    const notApproved = await makeRequest({ rule, status: "awaiting_owner" });
    await store.tx(async (tx) => {
      for (const { id } of [approved, answered, circleGrant]) {
        await tx.appendEvent({ requestId: id, at: now, kind: "permission", status: "awaiting_agent" });
      }
      await tx.appendEvent({ requestId: notApproved.id, at: now, kind: "permission", status: "awaiting_owner" });
    });
    // Restore the legacy schema and migration journal while keeping the fixture rows.
    await isolated.query("ALTER TABLE sideband.requests DROP COLUMN approved_once");
    await isolated.query("DROP TABLE sideband.contact_tags, sideband.tag_presets");
    await isolated.query("DROP TABLE sideband.circle_members, sideband.circles");
    await isolated.query("DROP TABLE sideband.friends");
    await isolated.query("DROP TABLE sideband.grants");
    await isolated.query("DELETE FROM sideband.__drizzle_migrations WHERE id > 1");

    await applyPostgresMigrations({ databaseUrl });

    await store.tx(async (tx) => {
      for (const { id } of [approved, answered]) {
        expect(await tx.getRequest(id)).toMatchObject({ approvedOnce: true });
      }
      for (const { id } of [noEvent, circleGrant, notApproved]) {
        expect(await tx.getRequest(id)).toMatchObject({ approvedOnce: undefined });
      }
    });
  });

  it("rolls back a migration that fails partway through its DDL", async () => {
    await isolated.query("DROP SCHEMA sideband CASCADE");
    await isolated.query("CREATE SCHEMA sideband");
    await isolated.query("CREATE TABLE sideband.users (existing_column int)");

    await expect(applyPostgresMigrations({ databaseUrl })).rejects.toThrow();
    const { rows: [rolledBack] } = await isolated.query(
      "SELECT to_regclass('sideband.agent_connections') AS agent_connections",
    );
    expect(rolledBack?.agent_connections).toBeNull();
    const { rows } = await isolated.query("SELECT id FROM sideband.__drizzle_migrations");
    expect(rows).toHaveLength(0);

    await isolated.query("DROP TABLE sideband.users");
    await applyPostgresMigrations({ databaseUrl });
    await createParticipants();
  });

  it("enforces the append-only audit trail with the local Postgres role", async () => {
    await createParticipants();
    const row = await makeRequest();
    await store.tx((tx) => tx.appendEvent({ requestId: row.id, at: now, kind: "received" }));
    for (const command of [
      "UPDATE sideband.request_events SET kind = 'delivery'",
      "DELETE FROM sideband.request_events",
      "TRUNCATE sideband.request_events",
    ]) {
      await expect(isolated.query(command)).rejects.toMatchObject({ code: "55000" });
    }
    expect(await store.tx((tx) => tx.listEvents([row.id]))).toMatchObject([{ kind: "received" }]);
  });

  it("grants a separate runtime role only the privileges needed by the Store", async () => {
    const runtimeRole = "sideband_test_" + randomUUID().replaceAll("-", "");
    const runtimePassword = randomBytes(32).toString("hex");
    try {
      await applyPostgresMigrations({ databaseUrl, runtimeRole, runtimePassword });
      await applyPostgresMigrations({ databaseUrl, runtimeRole, runtimePassword });
      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.username = runtimeRole;
      runtimeUrl.password = runtimePassword;
      const runtime = createPostgresStore({ databaseUrl: runtimeUrl.toString(), secretsKey });
      try {
        await createParticipants();
        const row = await makeRequest();
        await runtime.tx(async (tx) => {
          await tx.appendEvent({ requestId: row.id, at: now, kind: "received" });
          expect(await tx.listEvents([row.id])).toMatchObject([{ kind: "received" }]);
          expect(await tx.updateRequest(row.id, { guidance: "updated by runtime" }, row.version)).toBe(true);
          const friend = "alice@sideband.app";
          expect(await tx.addFriend("bruno", friend)).toBe(true);
          expect(await tx.addFriend("bruno", friend)).toBe(false);
          expect(await tx.listFriends("bruno")).toEqual([friend]);
          expect(await tx.removeFriend("bruno", friend)).toBe(true);
        });
      } finally {
        await runtime.close();
      }
      const { rows: [privileges] } = await isolated.query(
        "SELECT has_table_privilege($1, 'sideband.request_events', 'UPDATE, DELETE, TRUNCATE') AS can_mutate",
        [runtimeRole],
      );
      expect(privileges?.can_mutate).toBe(false);
    } finally {
      await isolated.query(`DROP OWNED BY ${pg.escapeIdentifier(runtimeRole)}`);
      await isolated.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(runtimeRole)}`);
    }
  });
});
