import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { applyPostgresMigrations } from "@team-31/broker/postgres";
import { createTestDatabase } from "@team-31/test-db";
import { expect, vi } from "vitest";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const closeServer = server => new Promise((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()));

// Base desechable de @team-31/test-db: drop() espera a que cierren los backends antes de
// borrarla, así un pool que aún cierra no recibe un 57P01 sin listener.
export async function isolatedDatabase(cleanup) {
  const testDb = await createTestDatabase("contacts");
  cleanup.defer(() => testDb.drop());
  vi.stubEnv("DATABASE_URL", testDb.url);
  await applyPostgresMigrations({ databaseUrl: testDb.url });
  return testDb.pool();
}

export function configureBroker() {
  vi.stubEnv("BROKER_HOST", "127.0.0.1");
  vi.stubEnv("BROKER_PORT", "0");
  const publicKeys = {};
  for (const issuer of ["web", "mcp"]) {
    const pair = generateKeyPairSync("ed25519");
    publicKeys[issuer] = pair.publicKey.export({ format: "jwk" });
    vi.stubEnv(issuer.toUpperCase() + "_SERVICE_PRIVATE_KEY", JSON.stringify(pair.privateKey.export({ format: "jwk" })));
  }
  vi.stubEnv("SERVICE_JWT_PUBLIC_KEYS", JSON.stringify(publicKeys));
  vi.stubEnv("BROKER_SIGNING_KEY", JSON.stringify(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" })));
  vi.stubEnv("WAKE_SECRETS_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NONCE_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("WAKE_ALLOW_INSECURE", "1");
  vi.stubEnv("REQUEST_TTL_SECONDS", "20");
  vi.stubEnv("WAKE_RETRY_DELAYS_MS", "0,0");
}

export async function startBroker(cleanup) {
  // Proceso real del broker, ejecutado desde su código fuente con tsx y la condición
  // "@team-31/source" (igual que Vitest): el test no depende del build de los paquetes.
  const root = import.meta.resolve("@team-31/broker-service/package.json");
  const tsx = createRequire(root).resolve("tsx");
  const entry = fileURLToPath(new URL("./src/index.ts", root));
  const child = spawn(process.execPath, ["--import", tsx, "--conditions=@team-31/source", entry], {
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, TELEMETRY_SINK: "console" },
  });
  const done = once(child, "exit");
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done;
  }
  cleanup.defer(stop);
  // El puerto viene del listener del hijo. Al reiniciar se conserva la URL de las sesiones.
  const lines = createInterface({ input: child.stdout, signal: AbortSignal.timeout(20_000) });
  let port;
  for await (const line of lines) {
    const record = JSON.parse(line);
    if (record.name === "service.listening" && record.service === "broker") {
      port = record.attrs.port;
      break;
    }
  }
  child.stdout.resume();
  if (!port) throw new Error("El broker no anunció su puerto durante el arranque.");
  vi.stubEnv("BROKER_PORT", String(port));
  vi.stubEnv("BROKER_URL", `http://127.0.0.1:${port}`);
  const health = await fetch(process.env.BROKER_URL + "/healthz");
  expect(health.ok).toBe(true);
  expect(await health.json()).toEqual({ ok: true });
  return stop;
}

export async function listenForWakes(cleanup, handle, root) {
  const notices = [];
  const errors = [];
  async function receive(req, res) {
    const id = req.url.split("/").at(-1);
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = new Request("http://" + req.headers.host + req.url, { method: req.method, headers: req.headers, body });
    let afterResponse;
    const response = await handle(request, id, callback => { afterResponse = callback; }, root);
    notices.push({ id, ...JSON.parse(body), status: response.status, scheduled: Boolean(afterResponse) });
    res.writeHead(response.status).end(await response.text());
    await afterResponse?.();
  }
  const server = createServer((req, res) => {
    void receive(req, res).catch(error => {
      errors.push(error);
      res.destroy();
    });
  });
  const port = await listen(server);
  cleanup.defer(() => closeServer(server));
  vi.stubEnv("WEB_PORT", String(port));
  vi.stubEnv("BETTER_AUTH_URL", `http://127.0.0.1:${port}`);
  return { notices, errors };
}
