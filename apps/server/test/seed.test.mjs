import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

test("expanding the demo seeds only new people and preserves existing access decisions", async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  const schema = "seed_" + randomUUID().replaceAll("-", "");
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const dir = await mkdtemp(join(tmpdir(), "coordination-seed-"));
  t.after(async () => {
    try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await db.end(); await rm(dir, { recursive: true }); }
  });
  await db.query(`CREATE SCHEMA ${schema}`);
  for (const file of ["01-core.sql", "03-contacts.sql", "04-demo-profiles.sql"]) {
    await db.query(await readFile(new URL("../sql/" + file, import.meta.url), "utf8"));
  }
  const seed = count => promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../scripts/seed.mjs", import.meta.url)), String(count), dir,
  ], { env: { ...process.env, DATABASE_URL: url.href, COORDINATION_API_URL: "http://seed.test.invalid" } });

  await seed(2);
  const config = await readFile(join(dir, "bob.json"), "utf8");
  const members = () => db.query("SELECT person_id, can_share FROM memberships WHERE group_id='futbol' ORDER BY person_id");
  assert.deepEqual((await members()).rows, [
    { person_id: "ana", can_share: true }, { person_id: "bob", can_share: true },
  ]);
  await db.query("UPDATE memberships SET can_share=false WHERE person_id='bob'");
  await db.query("DELETE FROM memberships WHERE person_id='ana'");

  await db.query("DELETE FROM contacts WHERE owner_id='ana' AND contact_id='bob'");
  await writeFile(join(dir, "bob-interests.json"), '["un dato editado"]');
  await seed(4);
  assert.equal(await readFile(join(dir, "bob.json"), "utf8"), config);
  assert.deepEqual((await db.query("SELECT id FROM people ORDER BY id")).rows.map(row => row.id),
    ["agente4", "ana", "bob", "carla", "eva"]);
  assert.deepEqual((await members()).rows, [
    { person_id: "agente4", can_share: true },
    { person_id: "bob", can_share: false },
    { person_id: "carla", can_share: true },
  ]);
  const events = await db.query("SELECT person_id, starts_at, ends_at FROM busy_slots");
  assert.deepEqual(events.rows, [{
    person_id: "bob", starts_at: new Date("2026-11-28T19:00:00Z"), ends_at: new Date("2026-11-28T20:00:00Z"),
  }]);

  await seed(14);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM demo_profiles")).rows[0].count, 15);
  const contacts = await db.query("SELECT contact_id FROM contacts WHERE owner_id='ana' ORDER BY contact_id");
  assert.deepEqual(contacts.rows.map(row => row.contact_id), ["carla", "ines", "jane", "luz"]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "bob-interests.json"))), ["un dato editado"]);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM interests")).rows[0].count, 0);
});
