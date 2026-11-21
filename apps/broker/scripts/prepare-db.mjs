import { applyPostgresMigrations } from "@team-31/broker/postgres";
import { applyOpsMigrations } from "@team-31/ops";
import { createTelemetry, postgresSink } from "@team-31/telemetry";
import pg from "pg";

const runtimeRole = "sideband_broker";
const { DATABASE_URL, BROKER_DATABASE_PASSWORD, POSTGRES_PORT, NODE_ENV } = process.env;
const printUrl = process.argv[2] === "--print-url";
const missingPassword = "Ejecuta pnpm bootstrap para preparar la contraseña local del broker.";

// The runtime role writes its own telemetry to ops.events. A direct grant (not membership in
// sideband_telemetry_writer) keeps the role NOINHERIT and without memberships, as the broker requires.
async function grantTelemetry(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const role = pg.escapeIdentifier(runtimeRole);
    await client.query(`GRANT USAGE ON SCHEMA ops TO ${role}`);
    await client.query(`GRANT INSERT ON ops.events TO ${role}`);
    await client.query(`GRANT USAGE ON SEQUENCE ops.events_id_seq TO ${role}`);
  } finally {
    await client.end();
  }
}

async function prepare() {
  if (!DATABASE_URL || NODE_ENV === "production") return DATABASE_URL;
  const url = new URL(DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== POSTGRES_PORT || url.username !== "postgres") {
    return DATABASE_URL;
  }
  if (!/^[0-9a-f]{64}$/.test(BROKER_DATABASE_PASSWORD ?? "")) throw new Error(missingPassword);

  await applyPostgresMigrations({ databaseUrl: DATABASE_URL, runtimeRole, runtimePassword: BROKER_DATABASE_PASSWORD });
  // ops goes after sideband.* and Better Auth (bootstrap order) so ops.refresh_views() finds their tables.
  await applyOpsMigrations({ databaseUrl: DATABASE_URL });
  await grantTelemetry(DATABASE_URL);
  url.username = runtimeRole;
  url.password = BROKER_DATABASE_PASSWORD;
  url.search = "";
  return url.href;
}

// Records the failure in ops.events without the Postgres message or credentials. stdout stays
// reserved for --print-url, so the sink is Postgres only (best effort if the database is down).
async function reportFailure(error) {
  if (!DATABASE_URL) return undefined;
  const telemetry = createTelemetry({
    service: "broker", sink: postgresSink(DATABASE_URL), heartbeatMs: 0, lifecycle: false,
  });
  const errorId = telemetry.error("broker.db.prepare", error);
  await telemetry.shutdown();
  return errorId;
}

try {
  const runtimeUrl = await prepare();
  if (printUrl && runtimeUrl) process.stdout.write(runtimeUrl);
} catch (error) {
  const message = error instanceof Error && error.message === missingPassword
    ? error.message : "No se pudo preparar Postgres para el broker local.";
  const errorId = await reportFailure(error).catch(() => undefined);
  console.error(errorId ? `${message} (errorId ${errorId})` : message);
  process.exitCode = 1;
}
