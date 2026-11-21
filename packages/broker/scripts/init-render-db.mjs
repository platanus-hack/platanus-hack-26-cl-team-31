import pg from "pg";
import { applyPostgresMigrations } from "../dist/store/postgres/index.js";

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
}

try {
  await prepare();
} catch (error) {
  console.error("[render] No se pudo preparar Postgres. Código:", error?.code ?? error?.name ?? "desconocido");
  process.exitCode = 1;
}
