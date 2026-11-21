import { generateKeyPairSync, randomUUID } from "node:crypto";
import { type AdminActor, type Principal, type WakeTarget, type Waker } from "@team-31/protocol";
import { createTelemetry, memorySink, type MemorySink } from "@team-31/telemetry";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBroker, createMemoryStore, type BrokerCore, type BrokerDeps } from "../index.js";
import { applyPostgresMigrations, createPostgresStore, type PostgresStore } from "../store/postgres/index.js";
import type { Store } from "../store/store.js";
import { verifyJson } from "./crypto.js";

const alice: Principal = { userId: "alice", agentId: "alice-bot", scopes: ["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"] };
const bruno: Principal = { userId: "bruno", agentId: "bruno-bot", scopes: ["nexo:ask", "nexo:inbox", "nexo:reply", "nexo:status"] };
const operator: AdminActor = { adminId: "admin-1", email: "ops@nexo.app" };
const reason = "La solicitud quedó atascada durante la demo";
const webhook: WakeTarget = { kind: "standard_webhook", url: "https://example.com/callback", secret: "whsec_demo" };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

type StoreFactory = { make(): Promise<Store>; close(): Promise<void> };

function memory(): StoreFactory {
  return { make: async () => createMemoryStore(), close: async () => {} };
}

function postgres(testDatabaseUrl: string): StoreFactory & { setup(): Promise<void>; teardown(): Promise<void> } {
  const databaseName = "nexo_admin_test_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool | undefined;
  let isolated: pg.Pool | undefined;
  let databaseUrl = "";
  let store: PostgresStore | undefined;
  return {
    async setup() {
      const url = new URL(testDatabaseUrl);
      if (!url.pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
      admin = new pg.Pool({ connectionString: testDatabaseUrl });
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
      url.pathname = "/" + databaseName;
      databaseUrl = url.toString();
      isolated = new pg.Pool({ connectionString: databaseUrl });
    },
    async make() {
      await isolated!.query("DROP SCHEMA IF EXISTS nexo CASCADE");
      await applyPostgresMigrations({ databaseUrl });
      store = createPostgresStore({ databaseUrl, secretsKey: Buffer.alloc(32, 42).toString("base64") });
      return store;
    },
    async close() {
      await store?.close();
      store = undefined;
    },
    async teardown() {
      try {
        await isolated?.end();
        await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
      } finally {
        await admin?.end();
      }
    },
  };
}

function runAdminPortTests(name: string, factory: StoreFactory) {
  describe(`AdminPort (${name})`, () => {
    let now: Date;
    let store: Store;
    let broker: BrokerCore;
    let sink: MemorySink;
    const wake = vi.fn<Waker["wake"]>();

    beforeEach(async () => {
      now = new Date("2026-11-21T15:00:00Z");
      wake.mockReset().mockResolvedValue({ ok: true, retryable: false, ms: 1 });
      store = await factory.make();
      sink = memorySink();
      const deps: BrokerDeps = {
        store,
        waker: { wake, verifyCallback: async () => ({ ok: true }) },
        telemetry: createTelemetry({ service: "worker", sink, lifecycle: false }),
        clock: { now: () => now },
        signingKey: privateKey,
        nonceKey: new Uint8Array(32).fill(4),
        config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 10_000, 30_000], addressDomain: "nexo.app" },
      };
      broker = createBroker(deps);
      await broker.owner.claimAddress(alice, "alice");
      await broker.owner.claimAddress(bruno, "bruno");
      await broker.owner.setGrant(bruno, { grantee: "alice@nexo.app", tool: "question", fields: ["answer"] });
      await broker.agent.connectWake(bruno, webhook);
    });

    afterEach(() => factory.close());

    function advance(ms: number) {
      now = new Date(now.getTime() + ms);
    }

    async function askAgent() {
      const view = await broker.agent.ask(alice, { to: "bruno@nexo.app", tool: "question", args: { text: "¿Vienes?" } });
      expect(view).toMatchObject({ final: false, waitingFor: "agent" });
      return view.requestId;
    }

    async function askOwner() {
      const requestId = await askAgent();
      const [item] = await broker.agent.inbox(bruno);
      expect(await broker.agent.reply(bruno, { requestId, nonce: item!.nonce, outcome: "needs_owner" }))
        .toMatchObject({ status: "awaiting_owner" });
      return requestId;
    }

    const events = (id: string) => store.tx((tx) => tx.listEvents([id]));
    const row = (id: string) => store.tx((tx) => tx.getRequest(id));

    describe("rewake", () => {
      it("adelanta el reintento existente y deja un evento admin_rewake", async () => {
        const requestId = await askAgent();
        wake.mockResolvedValueOnce({ ok: false, retryable: true, ms: 1 });
        expect(await broker.tick(now)).toMatchObject({ wakesRetried: 1 });
        const before = await row(requestId);

        await broker.admin.rewake(operator, requestId, reason);
        expect((await row(requestId))?.version).toBe(before!.version);
        expect((await events(requestId)).at(-1)).toMatchObject({ kind: "wake", code: "admin_rewake" });

        expect(await broker.tick(now)).toMatchObject({ wakesOk: 1, wakesRetried: 0, wakesFailed: 0 });
        expect(wake).toHaveBeenCalledTimes(2);
        // The original retry deadline does not trigger another delivery.
        advance(10_000);
        expect(await broker.tick(now)).toEqual({ expired: 0, wakesOk: 0, wakesRetried: 0, wakesFailed: 0 });
        expect(wake).toHaveBeenCalledTimes(2);
        expect((await events(requestId)).filter((event) => event.kind === "wake").map(({ code }) => code))
          .toEqual(["failed", "admin_rewake", "ok"]);
      });

      it("rechaza un reaviso durante la concesión activa e ignora el resultado del worker anterior", async () => {
        const requestId = await askAgent();
        let signalStarted!: () => void;
        let finish!: (result: Awaited<ReturnType<Waker["wake"]>>) => void;
        const started = new Promise<void>((resolve) => { signalStarted = resolve; });
        const inflight = new Promise<Awaited<ReturnType<Waker["wake"]>>>((resolve) => { finish = resolve; });
        wake.mockImplementationOnce(() => {
          signalStarted();
          return inflight;
        });
        const first = broker.tick(now);
        try {
          await Promise.race([
            started,
            first.then(() => { throw new Error("El worker terminó antes de iniciar el primer aviso."); }),
          ]);
          await expect(broker.admin.rewake(operator, requestId, reason)).rejects.toMatchObject({ code: "conflict" });
          advance(60_000);
          expect(await broker.tick(now)).toMatchObject({ wakesOk: 1 });
        } finally {
          finish({ ok: false, retryable: false, ms: 1 });
          await first;
        }
        expect(await first).toMatchObject({ wakesFailed: 0, wakesRetried: 0 });
        expect(wake).toHaveBeenCalledTimes(2);
        expect(sink.find("wake.lease_recovered")).toMatchObject([{ requestId, attrs: { attempt: 2 } }]);
        expect((await events(requestId)).filter(({ kind }) => kind === "wake").map(({ code }) => code)).toEqual(["ok"]);
        expect(await row(requestId)).toMatchObject({ status: "awaiting_agent" });
      });

      it("cierra la solicitud cuando el último aviso perdió su concesión", async () => {
        const requestId = await askAgent();
        for (const attempt of [1, 2, 3]) {
          const leaseUntil = new Date(now.getTime() + 60_000);
          const claimed = await store.tx((tx) => tx.claimDueWakes(now, leaseUntil, 1));
          expect(claimed).toMatchObject([{ requestId, attempt }]);
          advance(60_000);
        }

        expect(await broker.tick(now)).toMatchObject({ wakesFailed: 1 });
        expect(wake).not.toHaveBeenCalled();
        expect(sink.find("wake.exhausted")).toMatchObject([{ requestId, attrs: { attempts: 3 } }]);
        expect(await row(requestId)).toMatchObject({ status: "delivery_failed" });
        expect(await events(requestId)).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "wake", code: "lease_exhausted" }),
        ]));
      });

      it("continúa la cuenta de intentos: sin reintentos restantes, un aviso fallido cierra como delivery_failed", async () => {
        const requestId = await askAgent();
        wake.mockResolvedValue({ ok: true, retryable: false, ms: 1 });
        await broker.tick(now);
        await broker.admin.rewake(operator, requestId, reason); // attempt 2
        await broker.tick(now);
        await broker.admin.rewake(operator, requestId, reason); // attempt 3, the last configured
        wake.mockResolvedValue({ ok: false, retryable: true, ms: 1 });
        expect(await broker.tick(now)).toMatchObject({ wakesFailed: 1 });
        expect(await row(requestId)).toMatchObject({ status: "delivery_failed", outcome: "delivery_failed" });
      });

      it("rechaza solicitudes inexistentes, esperando al dueño, vencidas o cerradas", async () => {
        await expect(broker.admin.rewake(operator, "missing", reason)).rejects.toMatchObject({ code: "not_found" });
        const waitingOwner = await askOwner();
        await expect(broker.admin.rewake(operator, waitingOwner, reason)).rejects.toMatchObject({ code: "conflict" });

        const requestId = await askAgent();
        advance(900_000);
        await expect(broker.admin.rewake(operator, requestId, reason)).rejects.toMatchObject({ code: "conflict" });
        await broker.tick(now);
        await expect(broker.admin.rewake(operator, requestId, reason)).rejects.toMatchObject({ code: "conflict" });
        expect((await events(requestId)).some(({ code }) => code === "admin_rewake")).toBe(false);
      });

      it("valida el motivo y el operador sin tocar la solicitud", async () => {
        const requestId = await askAgent();
        const before = await row(requestId);
        await expect(broker.admin.rewake(operator, requestId, "corto")).rejects.toMatchObject({ code: "invalid_input" });
        await expect(broker.admin.rewake(operator, requestId, "x".repeat(501))).rejects.toMatchObject({ code: "invalid_input" });
        await expect(broker.admin.rewake({ adminId: "", email: "ops@nexo.app" }, requestId, reason))
          .rejects.toMatchObject({ code: "unauthorized" });
        expect(await row(requestId)).toEqual(before);
      });
    });

    describe("expire", () => {
      it.each(["awaiting_agent", "awaiting_owner"] as const)("cierra %s como expired firmado con un único evento final", async (status) => {
        const requestId = status === "awaiting_agent" ? await askAgent() : await askOwner();
        await broker.admin.expire(operator, requestId, reason);

        const view = await broker.agent.status(alice, requestId);
        expect(view).toMatchObject({ final: true, decision: "unanswered", outcome: "expired" });
        if (view.final) {
          expect(await verifyJson(publicKey, { requestId, outcome: "expired", result: undefined }, view.signature)).toBe(true);
        }
        expect(await row(requestId)).toMatchObject({ status: "expired", outcome: "expired", closedAt: now });
        expect((await events(requestId)).filter(({ kind }) => kind === "delivery"))
          .toEqual([expect.objectContaining({ status: "expired", code: "admin_expire" })]);

        await expect(broker.admin.expire(operator, requestId, reason)).rejects.toMatchObject({ code: "conflict" });
        advance(900_000);
        expect(await broker.tick(now)).toMatchObject({ expired: 0, wakesOk: 0 });
        expect((await events(requestId)).filter(({ kind }) => kind === "delivery")).toHaveLength(1);
      });

      it("compite con el barrido y con otro expire dejando exactamente un estado final", async () => {
        const requestId = await askAgent();
        advance(900_000);
        const results = await Promise.allSettled([
          broker.admin.expire(operator, requestId, reason),
          broker.tick(now),
          broker.admin.expire(operator, requestId, reason),
        ]);
        const [first, sweep, second] = results;
        expect(sweep.status).toBe("fulfilled");
        const adminWins = [first, second].filter(({ status }) => status === "fulfilled").length;
        const swept = sweep.status === "fulfilled" ? sweep.value.expired : 0;
        expect(adminWins + swept).toBe(1);
        for (const result of [first, second]) {
          if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "conflict" });
        }
        expect((await events(requestId)).filter(({ kind }) => kind === "delivery")).toHaveLength(1);
        expect(await row(requestId)).toMatchObject({ status: "expired" });
      });

      it("rechaza solicitudes inexistentes o ya respondidas y valida el motivo", async () => {
        await expect(broker.admin.expire(operator, "missing", reason)).rejects.toMatchObject({ code: "not_found" });
        const requestId = await askAgent();
        await expect(broker.admin.expire(operator, requestId, "   ")).rejects.toMatchObject({ code: "invalid_input" });
        const [item] = await broker.agent.inbox(bruno);
        await broker.agent.reply(bruno, { requestId, nonce: item!.nonce, outcome: "no_data" });
        await expect(broker.admin.expire(operator, requestId, reason)).rejects.toMatchObject({ code: "conflict" });
        expect(await row(requestId)).toMatchObject({ status: "no_data" });
      });
    });

    describe("revokeAgent", () => {
      it("revoca la conexión de cualquier usuario de forma idempotente", async () => {
        await broker.admin.revokeAgent(operator, "bruno", "bruno-bot", reason);
        const [connection] = await broker.owner.agents(bruno);
        expect(connection).toMatchObject({ agentId: "bruno-bot", revokedAt: now.toISOString() });
        await expect(broker.agent.inbox(bruno)).rejects.toMatchObject({ code: "not_found" });

        advance(1_000);
        await broker.admin.revokeAgent(operator, "bruno", "bruno-bot", reason);
        expect((await broker.owner.agents(bruno))[0]?.revokedAt).toBe(connection!.revokedAt);
      });

      it("devuelve not_found para una conexión inexistente y valida el motivo", async () => {
        await expect(broker.admin.revokeAgent(operator, "bruno", "ghost", reason)).rejects.toMatchObject({ code: "not_found" });
        await expect(broker.admin.revokeAgent(operator, "alice", "bruno-bot", reason)).rejects.toMatchObject({ code: "not_found" });
        await expect(broker.admin.revokeAgent(operator, "bruno", "bruno-bot", "")).rejects.toMatchObject({ code: "invalid_input" });
        expect((await broker.owner.agents(bruno))[0]?.revokedAt).toBeUndefined();
      });
    });
  });
}

runAdminPortTests("memoria", memory());

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
describe.skipIf(!testDatabaseUrl)("Postgres", () => {
  const factory = postgres(testDatabaseUrl);
  beforeAll(() => factory.setup());
  afterAll(() => factory.teardown());
  runAdminPortTests("Postgres", factory);
});
