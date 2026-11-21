import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { applyPostgresMigrations } from "@team-31/broker/postgres";
import pg from "pg";
import { expect, vi } from "vitest";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const closeServer = server => new Promise((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()));

export async function isolatedDatabase(cleanup) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  const dev = process.env.DATABASE_URL;
  if (!url.pathname.endsWith("_test") || (dev && url.pathname === new URL(dev).pathname)) {
    throw new Error("Usa una TEST_DATABASE_URL separada que termine en _test.");
  }
  const admin = new pg.Pool({ connectionString: url.href });
  cleanup.defer(() => admin.end());
  const name = "contacts_test_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  cleanup.defer(() => admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`));
  url.pathname = "/" + name;
  vi.stubEnv("DATABASE_URL", url.href);
  await applyPostgresMigrations({ databaseUrl: url.href });
  const db = new pg.Pool({ connectionString: url.href });
  cleanup.defer(() => db.end());
  return db;
}

export async function configureBroker() {
  const probe = createServer();
  const port = await listen(probe);
  await closeServer(probe);
  vi.stubEnv("BROKER_PORT", String(port));
  vi.stubEnv("BROKER_URL", `http://127.0.0.1:${port}`);
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
  const child = spawn(process.execPath, ["--import", tsx, "--conditions=@team-31/source", entry], { stdio: "ignore" });
  const done = once(child, "exit");
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await done;
  }
  cleanup.defer(stop);
  // Solo espera el arranque (sale apenas responde /healthz): margen amplio para máquinas cargadas.
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error("El proceso del broker terminó durante el arranque.");
    return fetch(process.env.BROKER_URL + "/healthz").then(res => res.ok, () => false);
  }, { timeout: 20_000, interval: 50 }).toBe(true);
  return stop;
}

export async function listenForWakes(cleanup, handle, root) {
  const notices = [];
  const errors = [];
  async function receive(req, res) {
    const id = req.url.split("/").at(-1);
    let body = "";
    for await (const chunk of req) body += chunk;
    notices.push({ id, requestId: JSON.parse(body).requestId });
    const request = new Request("http://" + req.headers.host + req.url, { method: req.method, headers: req.headers, body });
    let afterResponse;
    const response = await handle(request, id, callback => { afterResponse = callback; }, root);
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
