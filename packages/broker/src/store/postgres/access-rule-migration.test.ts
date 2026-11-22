import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPostgresMigrations, createPostgresStore } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
const drizzleFolder = fileURLToPath(new URL("../../../drizzle/", import.meta.url));

describe.skipIf(!testDatabaseUrl)("migración a una sola regla de acceso", () => {
  const databaseName = "sideband_access_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool;
  let db: pg.Pool;
  let databaseUrl: string;
  let previous: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDatabaseUrl });
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
    const url = new URL(testDatabaseUrl);
    url.pathname = "/" + databaseName;
    databaseUrl = url.toString();
    db = new pg.Pool({ connectionString: databaseUrl });
    previous = await mkdtemp(join(tmpdir(), "sideband-drizzle-"));
    await cp(drizzleFolder, previous, { recursive: true });
    const journalPath = join(previous, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag !== "0303_single_access_rule");
    await writeFile(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
    await admin?.end();
    if (previous) await rm(previous, { recursive: true, force: true });
  });

  it("conserva lo que cada contacto lee y deja preguntar por lo mismo", async () => {
    const client = await db.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: previous, migrationsSchema: "sideband" });
    } finally {
      client.release();
    }
    const address = (name: string) => `${name}@sideband.app`;
    const grant = (grantee: string, category: string) =>
      `('${randomUUID()}', 'ana', '${address(grantee)}', '${category}', now())`;
    // Ana never opened her vault. Bob follows Trabajo, Caro was edited by hand, Dani carries Familia with
    // everything turned off, Eva is not a contact and Fede reads a default category shared from the vault.
    await db.query(`
      INSERT INTO sideband.users (user_id, address, tags_seeded, vault_seeded) VALUES
        ('ana', '${address("ana")}', true, false), ('bob', '${address("bob")}', false, false), ('fede', '${address("fede")}', true, true);
      INSERT INTO sideband.tags (user_id, tag_id, name, color, categories) VALUES
        ('ana', 'work', 'Trabajo', 'violet', '["availability"]'), ('ana', 'family', 'Familia', 'amber', '["availability","health"]'),
        ('fede', 'work', 'Trabajo', 'violet', '[]');
      INSERT INTO sideband.friends (user_id, address) VALUES
        ('ana', '${address("bob")}'), ('ana', '${address("caro")}'), ('ana', '${address("dani")}'), ('fede', '${address("ana")}');
      INSERT INTO sideband.contact_tags (user_id, address, tag_id) VALUES
        ('ana', '${address("bob")}', 'work'), ('ana', '${address("caro")}', 'work'), ('ana', '${address("dani")}', 'family'),
        ('fede', '${address("ana")}', 'work');
      INSERT INTO sideband.grants (id, grantor_user_id, grantee_address, category, created_at) VALUES
        ${grant("bob", "availability")}, ${grant("caro", "general")}, ${grant("eva", "interests")};
      INSERT INTO sideband.vault_categories (owner_id, category_id, name, visibility) VALUES
        ('fede', 'health', 'Salud', 'private'), ('fede', 'interests', 'Intereses', 'public');
      INSERT INTO sideband.vault_permissions (owner_id, category_id, tag_id) VALUES ('fede', 'health', 'work');
    `);

    await applyPostgresMigrations({ databaseUrl });

    const { rows: rules } = await db.query(
      "SELECT address, category_id, allowed FROM sideband.vault_member_rules ORDER BY address, category_id");
    expect(rules).toEqual([
      { address: address("caro"), category_id: "availability", allowed: false },
      { address: address("caro"), category_id: "general", allowed: true },
      { address: address("dani"), category_id: "availability", allowed: false },
      { address: address("dani"), category_id: "health", allowed: false },
    ]);
    const { rows: live } = await db.query("SELECT grantee_address FROM sideband.grants WHERE revoked_at IS NULL");
    expect(live).toEqual([{ grantee_address: address("eva") }]);

    const store = createPostgresStore({ databaseUrl, secretsKey: Buffer.alloc(32, 1).toString("base64") });
    try {
      await store.tx(async (tx) => {
        const reads = async (owner: string, reader: string) => {
          const ids: string[] = [];
          for (const id of ["availability", "interests", "health", "general"]) {
            if (await tx.canReadVault(owner, address(reader), id)) ids.push(id);
          }
          return ids;
        };
        expect(await reads("ana", "bob")).toEqual(["availability"]);
        expect(await reads("ana", "caro")).toEqual(["general"]);
        expect(await reads("ana", "dani")).toEqual([]);
        expect(await reads("ana", "eva")).toEqual(["interests"]);
        expect(await reads("fede", "ana")).toEqual(["interests", "health"]);
        expect((await tx.listTags("ana")).map(({ id, categories }) => ({ id, categories }))).toEqual([
          { id: "family", categories: ["availability", "health"] }, { id: "work", categories: ["availability"] },
        ]);
        // Bob follows his tag: it now opens more, and so does he.
        await tx.putTag("ana", { id: "work", name: "Trabajo", color: "violet", categories: ["availability", "interests"] });
        expect(await reads("ana", "bob")).toEqual(["availability", "interests"]);
        expect(await reads("ana", "caro")).toEqual(["interests", "general"]);
        // A holder seeded after the migration gets the default tags with their categories.
        expect((await tx.listTags("bob")).find((tag) => tag.id === "family")?.categories)
          .toEqual(["availability", "interests", "health", "general"]);
      });
    } finally {
      await store.close();
    }
  });
});
