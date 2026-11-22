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

describe.skipIf(!testDatabaseUrl)("migración a etiquetas propias", () => {
  const databaseName = "sideband_tags_" + randomUUID().replaceAll("-", "");
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
    const tagsIndex = journal.entries.findIndex((entry) => entry.tag === "0014_custom_tags");
    expect(tagsIndex).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, tagsIndex);
    await writeFile(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(databaseName)}`);
    await admin?.end();
    if (previous) await rm(previous, { recursive: true, force: true });
  });

  it("convierte presets, etiquetas, grupos privados e invitaciones con grupo", async () => {
    const client = await db.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: previous, migrationsSchema: "sideband" });
    } finally {
      client.release();
    }
    const group = randomUUID();
    const clash = randomUUID();
    const category = randomUUID();
    const requestId = randomUUID();
    await db.query(`
      INSERT INTO sideband.users (user_id, address) VALUES ('ana', 'ana@sideband.app'), ('bob', 'bob@sideband.app'), ('eva', NULL);
      INSERT INTO sideband.friends (user_id, address) VALUES ('ana', 'bob@sideband.app');
      INSERT INTO sideband.tag_presets (user_id, tag, categories) VALUES ('ana', 'work', '["general"]');
      INSERT INTO sideband.contact_tags (user_id, address, tag) VALUES ('ana', 'bob@sideband.app', 'family');
      INSERT INTO sideband.vault_categories (owner_id, category_id, name) VALUES ('ana', $1, 'Salud');
      INSERT INTO sideband.vault_permissions (owner_id, category_id, contact_group) VALUES ('ana', $1, 'friend');
      INSERT INTO sideband.vault_contact_groups (owner_id, group_id, name) VALUES ('ana', $2, 'Isapres'), ('ana', $3, 'familia');
      INSERT INTO sideband.vault_contact_group_members (owner_id, group_id, address) VALUES ('ana', $2, 'bob@sideband.app');
      INSERT INTO sideband.vault_contact_group_permissions (owner_id, category_id, group_id) VALUES ('ana', $1, $2);
    `.replaceAll("$1", `'${category}'`).replaceAll("$2", `'${group}'`).replaceAll("$3", `'${clash}'`));
    await db.query(`
      INSERT INTO sideband.requests (id, from_address, to_address, from_user_id, to_user_id, sender_group_id, tool, args, status,
        allowed_fields, guidance, rule, escalated, envelope_signature, created_at, expires_at, version)
      VALUES ($1, 'ana@sideband.app', 'eva@sideband.app', 'ana', 'eva', $2, 'connect', '{}', 'awaiting_agent',
        '{}', '', '', false, '', now(), now() + interval '1 day', 0)`, [requestId, group]);

    await applyPostgresMigrations({ databaseUrl });

    const { rows: tags } = await db.query(
      "SELECT user_id, tag_id, name, color, categories FROM sideband.tags ORDER BY user_id, tag_id COLLATE \"C\"");
    const byId = (a: { tag_id: string }, b: { tag_id: string }) => (a.tag_id < b.tag_id ? -1 : Number(a.tag_id > b.tag_id));
    expect(tags).toEqual([
      ...[
        { user_id: "ana", tag_id: "friend", name: "Amigo", color: "emerald", categories: ["availability", "interests"] },
        { user_id: "ana", tag_id: "family", name: "Familia", color: "amber", categories: ["availability", "interests", "health", "general"] },
        { user_id: "ana", tag_id: clash, name: `familia (${clash.slice(0, 8)})`, color: "slate", categories: [] },
        { user_id: "ana", tag_id: group, name: "Isapres", color: "slate", categories: [] },
        { user_id: "ana", tag_id: "work", name: "Trabajo", color: "violet", categories: ["general"] },
      ].sort(byId),
      ...["bob", "eva"].flatMap((user_id) => [
        { user_id, tag_id: "family", name: "Familia", color: "amber", categories: ["availability", "interests", "health", "general"] },
        { user_id, tag_id: "friend", name: "Amigo", color: "emerald", categories: ["availability", "interests"] },
        { user_id, tag_id: "work", name: "Trabajo", color: "violet", categories: ["availability"] },
      ]),
    ]);
    const { rows: contactTags } = await db.query("SELECT address, tag_id FROM sideband.contact_tags ORDER BY address, tag_id");
    expect(contactTags).toEqual([
      { address: "bob@sideband.app", tag_id: "family" },
      { address: "bob@sideband.app", tag_id: group },
      { address: "eva@sideband.app", tag_id: group },
    ].sort((a, b) => a.address.localeCompare(b.address) || a.tag_id.localeCompare(b.tag_id)));
    const { rows: permissions } = await db.query(
      "SELECT tag_id FROM sideband.vault_permissions WHERE category_id = $1 ORDER BY tag_id", [category]);
    expect(permissions.map((row) => row.tag_id).sort()).toEqual(["friend", group].sort());
    const { rows: leftovers } = await db.query(`
      SELECT to_regclass('sideband.vault_contact_groups') AS groups, to_regclass('sideband.tag_presets') AS presets,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'sideband' AND column_name = 'sender_group_id') AS sender`);
    expect(leftovers).toEqual([{ groups: null, presets: null, sender: 0 }]);

    const store = createPostgresStore({ databaseUrl, secretsKey: Buffer.alloc(32, 1).toString("base64") });
    try {
      await store.tx(async (tx) => {
        expect((await tx.listTags("ana")).map((tag) => tag.id)).toEqual(["friend", "family", "work", clash, group]);
        expect((await tx.sharedVault("bob@sideband.app", "ana@sideband.app")).categories.filter(c => c.canRead))
          .toEqual([{ id: category, name: "Salud", visibility: "private", canRead: true }]);
        expect(await tx.deleteTag("eva", "work")).toBe(true);
        expect((await tx.listTags("eva")).map((tag) => tag.id)).toEqual(["friend", "family"]);
        await tx.createAddress("nuevo", "nuevo@sideband.app");
        expect((await tx.listTags("nuevo")).map((tag) => tag.id)).toEqual(["friend", "family", "work"]);
      });
    } finally {
      await store.close();
    }
  });
});
