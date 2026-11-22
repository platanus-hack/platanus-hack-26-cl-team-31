import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const drizzleFolder = fileURLToPath(new URL("../../../drizzle/", import.meta.url));

// A throwaway database with every migration before `tag` applied, to load the data a migration will convert.
export async function databaseBefore(testDatabaseUrl: string, tag: string) {
  const name = "sideband_migration_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: testDatabaseUrl });
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = "/" + name;
  const db = new pg.Pool({ connectionString: url.toString() });
  const previous = await mkdtemp(join(tmpdir(), "sideband-drizzle-"));
  await cp(drizzleFolder, previous, { recursive: true });
  const journalPath = join(previous, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 1) throw new Error(`No existe la migración ${tag}.`);
  journal.entries = journal.entries.slice(0, index);
  await writeFile(journalPath, JSON.stringify(journal));
  const client = await db.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: previous, migrationsSchema: "sideband" });
  } finally {
    client.release();
  }
  return {
    db, databaseUrl: url.toString(),
    async drop() {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)}`);
      await admin.end();
      await rm(previous, { recursive: true, force: true });
    },
  };
}
