import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export type PostgresMigrationOptions = {
  databaseUrl: string;
  /** An existing, dedicated database role for the broker's runtime connection. */
  runtimeRole?: string;
};

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/", import.meta.url));
const lockKey = "hashtext('nexo:broker:migrations')";

async function grantRuntimePrivileges(client: pg.PoolClient, runtimeRole: string) {
  const { rows: [session] } = await client.query<{ role: string }>("SELECT current_user AS role");
  if (session?.role === runtimeRole || runtimeRole.toLowerCase() === "public") {
    throw new Error("El rol de ejecución debe ser un rol de Postgres distinto del rol de migraciones.");
  }
  const role = pg.escapeIdentifier(runtimeRole);
  await client.query("BEGIN");
  try {
    await client.query(`GRANT USAGE ON SCHEMA nexo TO ${role}`);
    await client.query(`
      GRANT SELECT, INSERT, UPDATE ON
        nexo.users, nexo.sharing_rules, nexo.requests, nexo.wake_jobs, nexo.agent_connections
      TO ${role}
    `);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON nexo.request_events FROM ${role}`);
    await client.query(`GRANT SELECT, INSERT ON nexo.request_events TO ${role}`);
    await client.query(`GRANT USAGE ON SEQUENCE nexo.request_events_id_seq TO ${role}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function applyPostgresMigrations({ databaseUrl, runtimeRole }: PostgresMigrationOptions): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para aplicar las migraciones de Postgres.");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      // The lock covers the schema and migration journal check on all startup processes.
      await client.query(`SELECT pg_advisory_lock(${lockKey})`);
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "nexo" });
      if (runtimeRole !== undefined) await grantRuntimePrivileges(client, runtimeRole);
    } finally {
      // Closing the dedicated migration session also releases its advisory lock.
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}
