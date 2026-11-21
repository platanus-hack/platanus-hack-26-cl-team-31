import { readFile } from "node:fs/promises";
import { createTestDatabase, type TestDatabase } from "@team-31/test-db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWhatsAppStore } from "./store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("vínculo de WhatsApp en Postgres", () => {
  let testDb: TestDatabase;
  let db: pg.Pool;
  let store: ReturnType<typeof createWhatsAppStore>;

  beforeAll(async () => {
    testDb = await createTestDatabase("whatsapp_test");
    db = testDb.pool();
    await db.query(`CREATE TABLE public."user" (id text PRIMARY KEY, "phoneNumber" text UNIQUE)`);
    await db.query(await readFile(new URL("../../../scripts/whatsapp.sql", import.meta.url), "utf8"));
    await db.query(`INSERT INTO public."user" (id) VALUES ('ana'), ('bob')`);
    store = createWhatsAppStore(db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("consume el código, requiere confirmación por cuenta, protege la unicidad y permite revocar", async () => {
    const phone = "+56955550123";
    const old = (await store.start("ana"))!;
    const code = (await store.start("ana"))!;
    expect(await store.detect(old, phone)).toBeUndefined();
    expect(await store.detect(code, phone)).toBe("ana");
    expect(await store.detect(code, "+56955550124")).toBeUndefined();
    const candidate = (await store.state("ana"))!;
    expect(candidate).toMatchObject({ linked: null, phone });
    const run = vi.fn();
    const now = Math.ceil(Date.now() / 1000) + 2;
    await store.whileLinked(phone, now, run);
    expect(run).toHaveBeenLastCalledWith(undefined);
    expect(await store.confirm("bob", candidate.id!)).toBeUndefined();
    expect(await store.confirm("ana", candidate.id!)).toMatch(/^[a-f0-9-]{36}$/);
    expect(await store.confirm("ana", candidate.id!)).toBeUndefined();
    expect((await store.state("ana"))?.linked).toBe(phone);
    await store.whileLinked(phone, now - 10, run);
    expect(run).toHaveBeenLastCalledWith(undefined);
    await store.whileLinked(phone, now, run);
    expect(run).toHaveBeenLastCalledWith("ana");

    expect(await store.detect((await store.start("bob"))!, phone)).toBe("bob");
    await expect(store.confirm("bob", (await store.state("bob"))!.id!)).rejects.toMatchObject({ code: "23505" });
    expect((await store.state("bob"))!.linked).toBeNull();
    await store.unlink("ana");
    await store.whileLinked(phone, now, run);
    expect(run).toHaveBeenLastCalledWith(undefined);
    await db.query(`UPDATE whatsapp.pairing SET expires_at = now() - interval '1 minute' WHERE user_id = 'bob'`);
    expect(await store.state("bob")).toMatchObject({ linked: null, id: null });
  });

  it("entrega avisos al vínculo vigente, abre la ventana con cada mensaje y guarda entregas pendientes", async () => {
    const phone = "+56955550199";
    await db.query(`INSERT INTO public."user" (id) VALUES ('carla')`);
    expect(await store.detect((await store.start("carla"))!, phone)).toBe("carla");
    const linkId = (await store.confirm("carla", (await store.state("carla"))!.id!))!;
    const run = vi.fn();
    await store.whileNotified(linkId, run);
    expect(run).toHaveBeenLastCalledWith({ userId: "carla", phone, windowOpen: false });
    await store.whileLinked(phone, Math.ceil(Date.now() / 1000) + 1, async () => {});
    await store.whileNotified(linkId, run);
    expect(run).toHaveBeenLastCalledWith({ userId: "carla", phone, windowOpen: true });

    await store.addPending("carla", "request-1");
    await store.addPending("carla", "request-1");
    await store.addPending("carla", "request-2");
    expect(await store.pending("carla")).toEqual(["request-1", "request-2"]);
    await store.clearPending("carla", "request-1");
    expect(await store.pending("carla")).toEqual(["request-2"]);

    expect(await store.assignLinkId(phone)).toBeUndefined();
    await db.query(`UPDATE public."user" SET whatsapp_link_id = NULL WHERE id = 'carla'`);
    const issued = await store.assignLinkId(phone);
    expect(issued).toEqual({ userId: "carla", linkId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(await store.assignLinkId(phone)).toBeUndefined();
    await store.whileNotified(issued!.linkId, run);
    expect(run).toHaveBeenLastCalledWith({ userId: "carla", phone, windowOpen: true });

    await store.unlink("carla");
    await store.whileNotified(issued!.linkId, run);
    expect(run).toHaveBeenLastCalledWith(undefined);
    expect(await store.pending("carla")).toEqual([]);
  });

  it("registra una sola entrega ante reintentos concurrentes", async () => {
    expect((await Promise.all([store.claim("123", "wamid.1"), store.claim("123", "wamid.1")])).sort())
      .toEqual([false, true]);
  });

  it("al repetir la migración habilita las operaciones necesarias para el rol web de Render", async () => {
    const dbOwner = await db.connect();
    try {
      await dbOwner.query("BEGIN");
      await dbOwner.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_web_runtime') THEN
          CREATE ROLE nexo_web_runtime NOLOGIN;
        END IF;
      END $$`);
      await dbOwner.query(await readFile(new URL("../../../scripts/whatsapp.sql", import.meta.url), "utf8"));
      await dbOwner.query("SET LOCAL ROLE nexo_web_runtime");
      await dbOwner.query("SELECT phone FROM whatsapp.pairing");
      await dbOwner.query("INSERT INTO whatsapp.receipt VALUES ('render-test', now())");
      await dbOwner.query("DELETE FROM whatsapp.receipt WHERE id = 'render-test'");
      await dbOwner.query("SELECT request_id FROM whatsapp.pending_delivery");
      const { rows } = await dbOwner.query("SELECT has_table_privilege('whatsapp.receipt', 'UPDATE') AS can_update");
      expect(rows[0]?.can_update).toBe(false);
    } finally {
      await dbOwner.query("ROLLBACK");
      dbOwner.release();
    }
  });
});
