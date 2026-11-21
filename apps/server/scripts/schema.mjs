import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requerida");
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(313126)");
  const directory = new URL("../sql/", import.meta.url);
  for (const file of (await readdir(directory)).filter(f => f.endsWith(".sql")).sort()) {
    await db.query(await readFile(new URL(file, directory), "utf8"));
  }
  await db.query("COMMIT");
} finally { await db.end(); }
