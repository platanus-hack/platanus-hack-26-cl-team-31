import { applyOpsMigrations } from "@team-31/ops";
import { createTestDatabase, type TestDatabase } from "@team-31/test-db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTelemetry } from "../telemetry.js";
import { EventKind, Level, Service, type TelemetryRecord } from "../types.js";
import { postgresSink, type Queryable } from "./postgres.js";

function record(name: string): TelemetryRecord {
  return {
    at: new Date(), service: "broker", instance: "test:1", kind: "lifecycle", name, level: "info",
    traceId: null, spanId: null, parentSpanId: null, requestId: null, userId: null, agentId: null,
    durationMs: null, status: null, errorId: null, attrs: {},
  };
}

describe("postgresSink: cola", () => {
  it.each([0, -1, 0.5, NaN, Infinity])("rechaza el tamaño de lote inválido %s", (batchSize) => {
    expect(() => postgresSink({ batchSize })).toThrow(/batchSize/);
  });

  it("comparte el cierre del pool entre llamadas simultáneas", async () => {
    const sink = postgresSink({ connectionString: "postgres://localhost/unused" });
    const closing = sink.close();
    expect(sink.close()).toBe(closing);
    await closing;
  });

  it("con la cola llena descarta y cuenta dropped", async () => {
    const inserted: number[] = [];
    const pool: Queryable = {
      async query(_text, values) { inserted.push((values[0] as unknown[]).length); },
      async end() {},
    };
    const sink = postgresSink({ pool, maxQueue: 5, batchSize: 200, flushIntervalMs: 60_000 });
    for (let i = 0; i < 8; i++) sink.write(record("service.heartbeat"));
    expect(sink.stats()).toEqual({ queued: 5, dropped: 3, failed: 0, written: 0 });
    await sink.flush();
    expect(inserted).toEqual([5]);
    expect(sink.stats()).toEqual({ queued: 0, dropped: 3, failed: 0, written: 5 });
    await sink.close();
    sink.write(record("service.heartbeat"));
    expect(sink.stats().dropped).toBe(4);
  });

  it("escribe por lotes de batchSize y cuenta los lotes que fallan sin lanzar", async () => {
    const sizes: number[] = [];
    let calls = 0;
    const pool: Queryable = {
      async query(_text, values) {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error("password authentication failed for user x"), { code: "28P01" });
        sizes.push((values[0] as unknown[]).length);
      },
      async end() {},
    };
    const stderr = process.stderr.write;
    const lines: string[] = [];
    process.stderr.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      const sink = postgresSink({ pool, batchSize: 3, flushIntervalMs: 60_000 });
      for (let i = 0; i < 7; i++) sink.write(record("service.heartbeat"));
      await sink.flush();
      expect(sizes).toEqual([3, 1]);
      expect(sink.stats()).toEqual({ queued: 0, dropped: 0, failed: 3, written: 4 });
    } finally {
      process.stderr.write = stderr;
    }
    expect(lines.join("")).toContain("28P01");
    expect(lines.join("")).not.toContain("password");
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

describe.skipIf(!testDatabaseUrl)("postgresSink contra TEST_DATABASE_URL", () => {
  let testDb: TestDatabase;
  let db: pg.Pool;
  let databaseUrl: string;

  beforeAll(async () => {
    // Base propia para no chocar con otras suites que usan app_test en paralelo.
    testDb = await createTestDatabase("telemetry_test");
    databaseUrl = testDb.url;
    await applyOpsMigrations({ databaseUrl });
    db = testDb.pool();
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("uses the catalog enums in the migrated events table", async () => {
    const { rows } = await db.query<{ column_name: string; definition: string }>(`
      SELECT a.attname AS column_name, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND c.conkey = ARRAY[a.attnum]
      WHERE c.conrelid = 'ops.events'::regclass AND c.contype = 'c'
        AND a.attname IN ('service', 'kind', 'level')`);
    const enumValues = Object.fromEntries(rows.map(({ column_name, definition }) =>
      [column_name, [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()]));
    expect(enumValues).toEqual({
      service: [...Service.options].sort(), kind: [...EventKind.options].sort(), level: [...Level.options].sort(),
    });
  });

  it("escribe eventos, spans y errores en ops.events", async () => {
    const telemetry = createTelemetry({ service: "worker", version: "0.9.0", sink: postgresSink(databaseUrl) });
    let traceId = "";
    let errorId = "";
    await telemetry.span("wake.attempt", { requestId: "req_pg", userId: "u_1", agentId: "a_1" }, async (span) => {
      traceId = span.traceId;
      span.set({ kind: "webhook", attempt: 1, ok: false, httpStatus: 503 });
      telemetry.emit("broker.request.status_changed", { attrs: { from: "queued", to: "awaiting_agent", by: "broker" } });
      errorId = telemetry.error("wake.deliver", Object.assign(new Error("503 from https://hook.example/secret"), { code: "EWAKE" }));
    });
    await telemetry.shutdown();
    expect(telemetry.stats()).toMatchObject({ queued: 0, dropped: 0, failed: 0 });

    const { rows } = await db.query(
      "SELECT service, instance, kind, name, level, trace_id, span_id, parent_span_id, request_id, user_id, agent_id, duration_ms, status, error_id, attrs FROM ops.events ORDER BY id",
    );
    expect(rows.map((row) => row.name)).toEqual([
      "service.started", "service.heartbeat", "broker.request.status_changed", "error", "wake.attempt", "service.stopping",
    ]);
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(byName["service.started"]).toMatchObject({ service: "worker", kind: "lifecycle", trace_id: null, attrs: { version: "0.9.0" } });
    expect(byName["wake.attempt"]).toMatchObject({
      kind: "wake", trace_id: traceId, request_id: "req_pg", user_id: "u_1", agent_id: "a_1", status: "ok",
      attrs: { kind: "webhook", attempt: 1, ok: false, httpStatus: 503 },
    });
    expect(byName["wake.attempt"].duration_ms).toBeGreaterThanOrEqual(0);
    expect(byName["broker.request.status_changed"]).toMatchObject({ trace_id: traceId, parent_span_id: byName["wake.attempt"].span_id });
    expect(byName.error).toMatchObject({ kind: "error", level: "error", error_id: errorId, request_id: "req_pg", attrs: { operation: "wake.deliver", type: "Error", code: "EWAKE" } });
    expect(JSON.stringify(rows)).not.toContain("hook.example");
  });

  it("si la base rechaza el lote cuenta failed y no lanza", async () => {
    const sink = postgresSink({ connectionString: databaseUrl, flushIntervalMs: 60_000 });
    const lines: string[] = [];
    const stderr = process.stderr.write;
    process.stderr.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      // service fuera del CHECK: Postgres rechaza el INSERT completo.
      sink.write({ ...record("service.heartbeat"), service: "nope" as never });
      await sink.flush();
      expect(sink.stats()).toMatchObject({ failed: 1, written: 0 });
    } finally {
      process.stderr.write = stderr;
      await sink.close();
    }
    expect(lines.join("")).toContain("23514");
  });
});
