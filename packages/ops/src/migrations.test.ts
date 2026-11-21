import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOpsMigrations } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

// ops sin las tablas del broker, Better Auth ni coordinación: las vistas de telemetría existen y
// las demás aparecen al volver a llamar a ops.refresh_views() cuando sus tablas ya existen.
describe.skipIf(!testDatabaseUrl)("migraciones de ops", () => {
  const databaseName = "ops_test_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool;
  let db: pg.Pool;
  let databaseUrl: string;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl);
    const devUrl = process.env.DATABASE_URL;
    if (!url.pathname.endsWith("_test") || (devUrl && url.pathname === new URL(devUrl).pathname)) {
      throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
    }
    admin = new pg.Pool({ connectionString: testDatabaseUrl });
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
    url.pathname = "/" + databaseName;
    databaseUrl = url.toString();
    db = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    try {
      await db?.end();
      await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`);
    } finally {
      await admin?.end();
    }
  });

  async function views(): Promise<string[]> {
    const { rows } = await db.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'ops'::regnamespace AND relkind = 'v' ORDER BY 1",
    );
    return rows.map((row) => row.relname);
  }

  async function asRole<T>(role: string, sql: string): Promise<T[]> {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      const { rows } = await client.query(sql);
      return rows as T[];
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("aplica todas las migraciones una sola vez", async () => {
    expect(await applyOpsMigrations({ databaseUrl })).toEqual([
      "0001_events.sql",
      "0002_views.sql",
      "0003_roles.sql",
      "0004_prune.sql",
    ]);
    expect(await applyOpsMigrations({ databaseUrl })).toEqual([]);
    expect(await views()).toEqual(["v_errors", "v_events", "v_service_health"]);
    const { rows } = await db.query<{ rolname: string; rolcanlogin: boolean }>(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'nexo\\_%' ORDER BY 1",
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { rolname: "nexo_admin_reveal", rolcanlogin: false },
        { rolname: "nexo_admin_ro", rolcanlogin: false },
        { rolname: "nexo_telemetry_writer", rolcanlogin: false },
      ]),
    );
  });

  it("nexo_telemetry_writer solo inserta y nexo_admin_ro solo lee las vistas", async () => {
    await asRole("nexo_telemetry_writer", `
      INSERT INTO ops.events (service, instance, kind, name) VALUES ('broker', 'host:1', 'lifecycle', 'service.heartbeat')
    `);
    await expect(asRole("nexo_telemetry_writer", "SELECT * FROM ops.events")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole("nexo_telemetry_writer", "DELETE FROM ops.events")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole("nexo_admin_ro", "SELECT * FROM ops.events")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole("nexo_admin_ro", "SELECT ops.prune_events('1 day')")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole("nexo_admin_ro", "SELECT ops.refresh_views()")).rejects.toMatchObject({ code: "42501" });
    // asRole revierte su transacción: el latido visible se inserta con el dueño.
    await db.query(
      "INSERT INTO ops.events (service, instance, kind, name) VALUES ('broker', 'host:1', 'lifecycle', 'service.heartbeat')",
    );
    const health = await asRole<{ service: string; state: string }>(
      "nexo_admin_ro",
      "SELECT service, state FROM ops.v_service_health",
    );
    expect(health).toEqual([{ service: "broker", state: "up" }]);
  });

  it("refresh_views crea las vistas cuyas tablas aparecen después y les da permisos", async () => {
    await db.query(`
      CREATE TABLE people (id text PRIMARY KEY, token_hash text NOT NULL UNIQUE);
      CREATE TABLE memberships (
        person_id text NOT NULL REFERENCES people(id), group_id text NOT NULL,
        can_ask boolean NOT NULL DEFAULT false, can_share boolean NOT NULL DEFAULT false,
        PRIMARY KEY (person_id, group_id)
      );
      INSERT INTO people VALUES ('ana', 'hash-secreto');
      INSERT INTO memberships VALUES ('ana', 'g1', true, false), ('ana', 'g2', true, true);
    `);
    const { rows } = await db.query<{ created: string[] }>("SELECT ops.refresh_views() AS created");
    expect(rows[0]?.created).toContain("v_coordination_people");
    const people = await asRole("nexo_admin_ro", "SELECT * FROM ops.v_coordination_people");
    expect(people).toEqual([{ person_id: "ana", groups: ["g1", "g2"], can_ask: ["g1", "g2"], can_share: ["g2"] }]);
  });

  it("da a nexo_admin_ro SELECT solo en admin.audit cuando el servidor admin la crea", async () => {
    await db.query(`
      CREATE SCHEMA admin;
      CREATE TABLE admin.audit (id uuid PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), action text NOT NULL);
      CREATE TABLE admin.tokens (id uuid PRIMARY KEY, token_hash text NOT NULL);
    `);
    await db.query("SELECT ops.refresh_views()");
    expect(await asRole("nexo_admin_ro", "SELECT * FROM admin.audit")).toEqual([]);
    await expect(asRole("nexo_admin_ro", "SELECT * FROM admin.tokens")).rejects.toMatchObject({ code: "42501" });
  });

  it("prune_events borra solo lo más viejo que la retención", async () => {
    await db.query(`
      INSERT INTO ops.events (at, service, instance, kind, name) VALUES
        (now() - interval '20 days', 'web', 'host:2', 'http', 'http.request'),
        (now() - interval '15 days', 'web', 'host:2', 'http', 'http.request'),
        (now() - interval '1 day', 'web', 'host:2', 'http', 'http.request')
    `);
    const before = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM ops.events");
    const { rows } = await db.query<{ deleted: string }>("SELECT ops.prune_events(interval '14 days') AS deleted");
    expect(Number(rows[0]?.deleted)).toBe(2);
    const after = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM ops.events");
    expect(after.rows[0]?.n).toBe((before.rows[0]?.n ?? 0) - 2);
    await expect(db.query("SELECT ops.prune_events(interval '5 minutes')")).rejects.toMatchObject({ code: "22023" });
  });
});
