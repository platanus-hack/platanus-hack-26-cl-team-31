import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export type PostgresMigrationOptions = {
  databaseUrl: string;
  /** A dedicated database role for the broker's runtime connection. */
  runtimeRole?: string;
  /** When provided, provision a dedicated login with this password before granting access. */
  runtimePassword?: string;
};

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/", import.meta.url));
const lockKey = "hashtext('sideband:broker:migrations')";

async function provisionRuntimeLogin(client: pg.PoolClient, roleName: string, password: string) {
  const role = pg.escapeIdentifier(roleName);
  try {
    await client.query(`CREATE ROLE ${role} LOGIN NOINHERIT`);
  } catch (error) {
    if (!["42710", "23505"].includes((error as { code?: string }).code ?? "")) throw error;
  }
  const { rows: [safe] } = await client.query<{ allowed: boolean }>(`
    SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid) AS allowed
    FROM pg_roles WHERE rolname = $1 AND rolname <> current_user
  `, [roleName]);
  if (!safe?.allowed) throw new Error("El broker requiere un rol de conexión dedicado y sin privilegios administrativos.");
  await client.query(`ALTER ROLE ${role} PASSWORD ${pg.escapeLiteral(password)}`);
}

async function grantRuntimePrivileges(client: pg.PoolClient, runtimeRole: string) {
  const { rows: [session] } = await client.query<{ role: string }>("SELECT current_user AS role");
  if (session?.role === runtimeRole || runtimeRole.toLowerCase() === "public") {
    throw new Error("El rol de ejecución debe ser un rol de Postgres distinto del rol de migraciones.");
  }
  const role = pg.escapeIdentifier(runtimeRole);
  await client.query("BEGIN");
  await client.query(`GRANT USAGE ON SCHEMA sideband TO ${role}`);
  await client.query(`
    GRANT SELECT, INSERT, UPDATE ON
      sideband.users, sideband.sharing_rules, sideband.grants, sideband.requests, sideband.wake_jobs, sideband.agent_connections
    TO ${role}
  `);
  await client.query(`GRANT SELECT, INSERT, DELETE ON sideband.friends TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON sideband.circles, sideband.circle_members TO ${role}`);
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON sideband.request_events FROM ${role}`);
  await client.query(`GRANT SELECT, INSERT ON sideband.request_events TO ${role}`);
  await client.query(`GRANT USAGE ON SEQUENCE sideband.request_events_id_seq TO ${role}`);
  await client.query("COMMIT");
}

export async function applyPostgresMigrations({ databaseUrl, runtimeRole, runtimePassword }: PostgresMigrationOptions): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para aplicar las migraciones de Postgres.");
  if (runtimePassword !== undefined && (!runtimeRole || !runtimePassword)) {
    throw new Error("Indica un rol y una contraseña para provisionar la conexión del broker.");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      // The lock covers the schema and migration journal check on all startup processes.
      await client.query(`SELECT pg_advisory_lock(${lockKey})`);
      if (runtimeRole && runtimePassword !== undefined) await provisionRuntimeLogin(client, runtimeRole, runtimePassword);
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "sideband" });
      if (runtimeRole !== undefined) await grantRuntimePrivileges(client, runtimeRole);
    } finally {
      // Closing the dedicated migration session rolls back unfinished grants and releases its lock.
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}
