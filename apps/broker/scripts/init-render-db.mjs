import pg from "pg";
import { applyPostgresMigrations } from "@team-31/broker/postgres";
import { applyOpsMigrations } from "@team-31/ops";

const { DATABASE_URL, BROKER_DB_PASSWORD, WEB_DB_PASSWORD } = process.env;
const brokerRole = "nexo_broker_runtime";
const webRole = "nexo_web_runtime";

async function prepare() {
  if (!DATABASE_URL || !BROKER_DB_PASSWORD || !WEB_DB_PASSWORD) {
    throw new Error("Falta configurar la base de datos o las credenciales de ejecución.");
  }
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nexo:render:roles'))");
    const secret = pg.escapeLiteral(WEB_DB_PASSWORD);
    const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [webRole]);
    await client.query(rowCount
      ? `ALTER ROLE ${webRole} PASSWORD ${secret}`
      : `CREATE ROLE ${webRole} LOGIN NOINHERIT PASSWORD ${secret}`);
    // This database belongs to Nexo; Better Auth owns all tables in public.
    await client.query(`GRANT USAGE ON SCHEMA public TO ${webRole}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${webRole}`);
    await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${webRole}`);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await applyPostgresMigrations({
    databaseUrl: DATABASE_URL,
    runtimeRole: brokerRole,
    runtimePassword: BROKER_DB_PASSWORD,
  });
  await applyOpsMigrations({ databaseUrl: DATABASE_URL });

  const telemetryClient = new pg.Client({ connectionString: DATABASE_URL });
  await telemetryClient.connect();
  try {
    const roles = [brokerRole, webRole].map((role) => pg.escapeIdentifier(role)).join(", ");
    await telemetryClient.query(`GRANT USAGE ON SCHEMA ops TO ${roles}`);
    await telemetryClient.query(`GRANT INSERT ON ops.events TO ${roles}`);
    await telemetryClient.query(`GRANT USAGE ON SEQUENCE ops.events_id_seq TO ${roles}`);
  } finally {
    await telemetryClient.end();
  }
}

try {
  await prepare();
} catch (error) {
  console.error("[render] No se pudo preparar Postgres. Código:", error?.code ?? error?.name ?? "desconocido");
  process.exitCode = 1;
}
