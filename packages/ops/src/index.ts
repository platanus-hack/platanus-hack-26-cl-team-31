import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Dueño del esquema `ops` (telemetría y vistas del admin). Cada archivo de sql/ corre una
// sola vez, en orden, dentro de una transacción y con un candado consultivo.
// Ver docs/admin.md#datos.
const sqlFolder = fileURLToPath(new URL("../sql/", import.meta.url));
const LOCK = "hashtext('nexo:ops:migrations')";

export async function applyOpsMigrations({ databaseUrl }: { databaseUrl: string }): Promise<string[]> {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para aplicar las migraciones de ops.");
  const files = (await readdir(sqlFolder)).filter((file) => file.endsWith(".sql")).sort();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK})`);
    await client.query("CREATE SCHEMA IF NOT EXISTS ops");
    await client.query(
      "CREATE TABLE IF NOT EXISTS ops.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM ops.migrations");
    const done = new Set(rows.map((row) => row.name));
    for (const file of files.filter((name) => !done.has(name))) {
      const sql = await readFile(new URL(file, `file://${sqlFolder}`), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO ops.migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    // Views over tables created after ops (broker, Better Auth, coordination) appear here.
    // Idempotent: run it again after migrating those modules.
    const { rows: [refresh] } = await client.query<{ exists: boolean }>(
      "SELECT to_regprocedure('ops.refresh_views()') IS NOT NULL AS exists",
    );
    if (refresh?.exists) await client.query("SELECT ops.refresh_views()");
    await client.query("SELECT ops.refresh_whatsapp_view()");
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK})`).catch(() => undefined);
    await client.end();
  }
  return applied;
}
