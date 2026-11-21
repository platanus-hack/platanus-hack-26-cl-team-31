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
    expect(run).toHaveBeenLastCalledWith(undefined, undefined);
    expect(await store.confirm("bob", candidate.id!)).toBeUndefined();
    expect(await store.confirm("ana", candidate.id!)).toMatch(/^[a-f0-9-]{36}$/);
    expect(await store.confirm("ana", candidate.id!)).toBeUndefined();
    expect((await store.state("ana"))?.linked).toBe(phone);
    await store.whileLinked(phone, now - 10, run);
    expect(run).toHaveBeenLastCalledWith(undefined, undefined);
    await store.whileLinked(phone, now, run);
    expect(run).toHaveBeenLastCalledWith("ana", expect.any(String));

    expect(await store.detect((await store.start("bob"))!, phone)).toBe("bob");
    await expect(store.confirm("bob", (await store.state("bob"))!.id!)).rejects.toMatchObject({ code: "23505" });
    expect((await store.state("bob"))!.linked).toBeNull();
    await store.unlink("ana");
    await store.whileLinked(phone, now, run);
    expect(run).toHaveBeenLastCalledWith(undefined, undefined);
    await db.query(`UPDATE whatsapp.pairing SET expires_at = now() - interval '1 minute' WHERE user_id = 'bob'`);
    expect(await store.state("bob")).toMatchObject({ linked: null, id: null });
  });

  it("entrega avisos al vínculo vigente, abre la ventana con cada mensaje y guarda entregas pendientes", async () => {
    const phone = "+56955550199";
    const timestamp = Math.ceil(Date.now() / 1000) + 2;
    await db.query(`INSERT INTO public."user" (id) VALUES ('carla')`);
    expect(await store.detect((await store.start("carla"))!, phone)).toBe("carla");
    const linkId = (await store.confirm("carla", (await store.state("carla"))!.id!))!;
    const run = vi.fn();
    await store.whileNotified(linkId, run);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "carla", phone, windowOpen: false }));
    await store.whileNotified(linkId, async (link) => {
      const send = vi.fn();
      expect(await link!.acceptNotice("request-1", "final", send)).toBe(true);
      expect(await link!.acceptNotice("request-1", "final", send)).toBe(false);
      expect(await link!.acceptNotice("request-2", "owner", send)).toBe(true);
      expect(send).not.toHaveBeenCalled();
    });
    await store.whileLinked(phone, Math.ceil(Date.now() / 1000) + 1, async () => {});
    await store.whileNotified(linkId, run);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "carla", phone, windowOpen: true }));

    expect(await store.pending(phone, timestamp)).toEqual(["request-1", "request-2"]);
    const deliverPending = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const retry = () => store.deliverPending(phone, timestamp, "request-1", deliverPending);
    await expect(retry()).rejects.toThrow("offline");
    await Promise.all([retry(), retry()]);
    expect(deliverPending).toHaveBeenCalledTimes(2);
    expect(await store.pending(phone, timestamp)).toEqual(["request-2"]);

    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const deliver = () => store.whileNotified(linkId, async (link) => {
      await link!.acceptNotice("request-3", "final", send);
    });
    await expect(deliver()).rejects.toThrow("offline");
    await Promise.all([deliver(), deliver()]);
    expect(send).toHaveBeenCalledTimes(2);

    await db.query(`UPDATE public."user" SET whatsapp_link_id = NULL WHERE id = 'carla'`);
    const register = vi.fn<(userId: string, linkId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false).mockResolvedValue(true);
    const registerPhone = () => store.registerChannel({ phone, timestamp }, register);
    await registerPhone();
    await Promise.all([registerPhone(), registerPhone()]);
    const issued = register.mock.calls[0]![1];
    expect(issued).toMatch(/^[a-f0-9-]{36}$/);
    expect(register.mock.calls).toEqual([["carla", issued], ["carla", issued]]);
    await store.whileNotified(issued, run);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "carla", phone, windowOpen: true }));

    await store.unlink("carla");
    await store.whileNotified(issued, run);
    expect(run).toHaveBeenLastCalledWith(undefined);
    expect(await store.pending(phone, timestamp)).toEqual([]);
  });

  it("registra una sola entrega ante reintentos concurrentes", async () => {
    expect((await Promise.all([store.claim("123", "wamid.1"), store.claim("123", "wamid.1")])).sort())
      .toEqual([false, true]);
  });

  it("confirma el recibo del turno solo después de entregar y serializa copias del mismo evento", async () => {
    const delivery = { numberId: "wa", messageId: "turn-retry" };
    const dispatch = vi.fn().mockRejectedValueOnce(new Error("falló la entrega")).mockResolvedValue(undefined);
    const run = () => store.whileLinked("+56955550222", Math.ceil(Date.now() / 1000), dispatch, delivery);
    await expect(run()).rejects.toThrow("falló la entrega");
    await Promise.all([run(), run()]);
    expect(dispatch).toHaveBeenCalledTimes(2);
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
