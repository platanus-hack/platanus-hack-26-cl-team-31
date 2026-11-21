import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWhatsAppStore } from "./store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("vínculo de WhatsApp en Postgres", () => {
  const name = "whatsapp_test_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool;
  let db: pg.Pool;
  let store: ReturnType<typeof createWhatsAppStore>;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!url.pathname.endsWith("_test")) throw new Error("Usa una base _test para las pruebas.");
    admin = new pg.Pool({ connectionString: url.href });
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    url.pathname = name;
    db = new pg.Pool({ connectionString: url.href });
    await db.query(`CREATE TABLE public."user" (id text PRIMARY KEY, "phoneNumber" text UNIQUE)`);
    await db.query(await readFile(new URL("../../../scripts/whatsapp.sql", import.meta.url), "utf8"));
    await db.query(`INSERT INTO public."user" (id) VALUES ('ana'), ('bob')`);
    store = createWhatsAppStore(db);
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
    await admin?.end();
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
    expect(await store.confirm("bob", candidate.id!)).toBe(false);
    expect(await store.confirm("ana", candidate.id!)).toBe(true);
    expect(await store.confirm("ana", candidate.id!)).toBe(false);
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

  it("registra una sola entrega ante reintentos concurrentes", async () => {
    expect((await Promise.all([store.claim("123", "wamid.1"), store.claim("123", "wamid.1")])).sort())
      .toEqual([false, true]);
  });
});
