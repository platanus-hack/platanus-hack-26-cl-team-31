import { applyPostgresMigrations } from "@team-31/broker/postgres";

const runtimeRole = "nexo_broker";
const { DATABASE_URL, BROKER_DATABASE_PASSWORD, POSTGRES_PORT, NODE_ENV } = process.env;
const printUrl = process.argv[2] === "--print-url";

async function prepare() {
  if (!DATABASE_URL || NODE_ENV === "production") return DATABASE_URL;
  const url = new URL(DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== POSTGRES_PORT || url.username !== "postgres") {
    return DATABASE_URL;
  }
  if (!/^[0-9a-f]{64}$/.test(BROKER_DATABASE_PASSWORD ?? "")) {
    throw new Error("Ejecuta pnpm bootstrap para preparar la contraseña local del broker.");
  }

  // TODO(admin): registrar el resultado de preparación del rol sin la URL ni la contraseña.
  await applyPostgresMigrations({ databaseUrl: DATABASE_URL, runtimeRole, runtimePassword: BROKER_DATABASE_PASSWORD });
  url.username = runtimeRole;
  url.password = BROKER_DATABASE_PASSWORD;
  url.search = "";
  return url.href;
}

try {
  const runtimeUrl = await prepare();
  if (printUrl && runtimeUrl) process.stdout.write(runtimeUrl);
} catch (error) {
  // TODO(admin): registrar el error de preparación sin el mensaje de Postgres ni las credenciales.
  const message = error instanceof Error && error.message === "Ejecuta pnpm bootstrap para preparar la contraseña local del broker."
    ? error.message : "No se pudo preparar Postgres para el broker local.";
  console.error(message);
  process.exitCode = 1;
}
