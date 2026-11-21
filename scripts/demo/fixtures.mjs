import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { getAuthOptions } from "../../apps/web/src/lib/auth-env.mjs";

const load = (app, name) => import(createRequire(new URL(`../../apps/${app}/package.json`, import.meta.url)).resolve(name));
const state = new URL("../../.agents-local/nexo-demo.json", import.meta.url);
const pendingState = new URL("nexo-demo.pending.json", state);
export const names = { simon: "Simon (demo)", dot: "Dot local", grok: "Grok Bot local", claude: "Claude Code local" };

function localUrl(value, port, protocol = "http:") {
  const url = new URL(value);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol === protocol &&
    url.port === port, "Usa las URLs de loopback y puertos del worktree generados por pnpm bootstrap.");
  return url;
}

export async function createFixtures({ run, withSessions = false } = {}) {
  assert.notEqual(process.env.NODE_ENV, "production", "Usa un stack local de desarrollo.");
  const options = getAuthOptions();
  const { WEB_PORT, MCP_PORT, BROKER_PORT, POSTGRES_PORT } = process.env;
  const web = localUrl(options.baseUrl, WEB_PORT);
  const mcp = localUrl(options.mcpResource, MCP_PORT);
  const broker = localUrl(process.env.BROKER_URL, BROKER_PORT);
  const db = localUrl(options.databaseUrl, POSTGRES_PORT, "postgresql:");
  assert.equal(web.hostname, "127.0.0.1", "Usa BETTER_AUTH_URL generado por bootstrap para iniciar sesión en el navegador.");
  assert.equal(db.pathname, "/app", "Usa DATABASE_URL generado por bootstrap como referencia del worktree.");
  if (run) db.pathname = "/" + databaseName(run);

  const [{ createAuth, migrateAuth }, { mintServiceToken }, { createOwnerClient }, { betterAuth }, { testUtils }, pg] = await Promise.all([
    load("web", "@team-31/auth/server"),
    load("web", "@team-31/auth/service"),
    load("web", "@team-31/broker/client"),
    load("web", "better-auth"),
    load("web", "better-auth/plugins"),
    import(createRequire(new URL("../../packages/auth/package.json", import.meta.url)).resolve("pg")),
  ]);
  const authOptions = { ...options, databaseUrl: db.href, google: undefined };
  const auth = withSessions ? createAuth(authOptions) : undefined;
  const authPool = auth?.options.database ?? new pg.default.Pool({ connectionString: db.href });
  let database;
  try {
    database = await authPool.connect();
    const { rows: [result] } = await database.query("SELECT pg_try_advisory_lock(190031) AS acquired");
    assert(result.acquired, "Ya hay un comando de la demo en ejecución en esta base.");
    const owner = createOwnerClient({
      baseUrl: broker.href,
      getServiceToken: ({ userId }) => mintServiceToken({
        iss: "web", sub: userId, privateKey: JSON.parse(process.env.WEB_SERVICE_PRIVATE_KEY),
      }),
    });
    let test;
    if (auth) {
      await auth.$context;
      test = (await betterAuth({ ...auth.options, plugins: [testUtils()] }).$context).test;
    }
    return {
      web, mcp, owner, database, db, test, migrate: (databaseUrl) => migrateAuth({ ...authOptions, databaseUrl }),
      async close() {
        database.release(true);
        await authPool.end();
      },
    };
  } catch (error) {
    database?.release(true);
    await authPool.end();
    throw error;
  }
}

function databaseName(run) {
  assert(/^[0-9a-f]{16}$/.test(run), "Identificador inválido para la base de la demo.");
  return "app_nx19_" + run;
}

function databaseComment(run) {
  return "NX-19 demo local " + run;
}

export async function init({ database, db, web, migrate }) {
  assert(!await readState(), "Ya hay una demo preparada. Ejecuta reset antes de crear otra.");
  const run = randomBytes(8).toString("hex");
  const name = databaseName(run);
  const config = { run, web: web.origin, port: db.port };
  await database.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  try {
    await database.query(`COMMENT ON DATABASE "${name}" IS '${databaseComment(run)}'`);
    const url = new URL(db);
    url.pathname = "/" + name;
    await migrate(url.href);
    await mkdir(new URL(".", state), { recursive: true, mode: 0o700 });
    await saveState(config);
  } catch (error) {
    await database.query(`DROP DATABASE "${name}"`);
    throw error;
  }
  console.log(`Base descartable preparada: ${name}. Inicia el stack de la demo.`);
}

export async function reset({ database }, { run }) {
  const name = databaseName(run);
  const { rows } = await database.query(`
    SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1
  `, [name]);
  if (rows.length) {
    assert.equal(rows[0].marker, databaseComment(run), "Falta la marca de la demo en esta base. Se conservó intacta.");
    try {
      await database.query(`DROP DATABASE "${name}"`);
    } catch (error) {
      if (error.code === "55006") throw new Error("Detén primero el stack de la demo. La base sigue en uso.");
      throw error;
    }
  }
  await unlink(state);
  await unlink(pendingState).catch((error) => { if (error.code !== "ENOENT") throw error; });
  console.log("Base descartable de la demo eliminada.");
}

function localPart(actor, run) {
  return `nx19-${actor}-${run}`;
}

function email(actor, run) {
  return `${localPart(actor, run)}@nexo-demo.invalid`;
}

function redirectPath(run) {
  return `/nx19-fixture/${run}`;
}

export async function readState() {
  try {
    const saved = JSON.parse(await readFile(state, "utf8"));
    assert(/^[0-9a-f]{16}$/.test(saved.run), "El archivo de la demo no tiene un identificador válido.");
    return saved;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveState(fixture) {
  await writeFile(pendingState, JSON.stringify(fixture), { mode: 0o600 });
  await rename(pendingState, state);
}

export async function seed({ test, owner, database, mcp, web }, fixture) {
  assert(!fixture.actors, "Las cuentas ya están preparadas.");
  const { run } = fixture;
  const health = await fetch(new URL("/healthz", mcp), { signal: AbortSignal.timeout(5_000), redirect: "error" });
  assert(health.ok, "Inicia el stack de la demo y espera el mensaje de MCP.");
  const metadata = await fetch(new URL("/.well-known/oauth-authorization-server", web), {
    signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  assert(metadata.ok, "Inicia el stack de la demo y espera el mensaje de Next.js.");
  const probe = { userId: "nx19-demo-probe-" + run };
  const address = `nx19-probe-${run}@nexo.app`;
  await database.query("INSERT INTO nexo.users (user_id, address) VALUES ($1, $2) ON CONFLICT DO NOTHING", [probe.userId, address]);
  assert.equal((await owner.me(probe)).address, address, "El broker debe usar la base preparada por el comando stack.");

  const actors = {};
  for (const [role, name] of Object.entries(names)) {
    const addressEmail = email(role, run);
    const { rows: [existing] } = await database.query('SELECT id FROM "user" WHERE email = $1', [addressEmail]);
    const { id: userId } = existing ?? await test.saveUser(test.createUser({ name, email: addressEmail }));
    const { address } = await owner.me({ userId });
    actors[role] = { userId, address: address ?? await owner.claimAddress({ userId }, localPart(role, run)) };
  }
  for (const { address } of [actors.dot, actors.grok]) {
    await owner.setGrant(actors.simon, { grantee: address, tool: "availability", fields: ["available", "freeSlots"] });
  }
  await saveState({ ...fixture, actors });
  console.log(`Demo preparada para ${actors.simon.address}. Dot y Grok tienen permiso. Claude Code todavía no.`);
}

export async function oauthAgent({ web, mcp }, { run, name, session }) {
  const issuer = new URL("/api/auth/", web);
  const redirect = new URL(redirectPath(run), web).href;

  async function request(path, expected, init) {
    const response = await fetch(new URL(path, issuer), {
      ...init, signal: AbortSignal.timeout(20_000), redirect: "error",
    });
    assert.equal(response.status, expected, `OAuth ${path.split("?")[0]} (${name})`);
    return response.json();
  }

  const { client_id: agentId } = await request("oauth2/register", 201, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `NX-19 ${run} ${name}`, redirect_uris: [redirect], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: agentId, response_type: "code", redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", state: randomUUID(),
  });
  const headers = new Headers(session.headers);
  headers.set("Accept", "application/json");
  headers.set("Origin", web.origin);
  const consent = new URL((await request(`oauth2/authorize?${query}`, 200, { headers })).url, web);
  assert.equal(consent.origin + consent.pathname, new URL("/consent", web).href, "Pantalla local de consentimiento");
  headers.set("Content-Type", "application/json");
  const callback = new URL((await request("oauth2/consent", 200, {
    method: "POST", headers, body: JSON.stringify({ accept: true, oauth_query: consent.search.slice(1) }),
  })).url);
  assert.equal(callback.origin + callback.pathname, redirect, "Retorno local de OAuth");
  assert(callback.searchParams.get("state") === query.get("state"), "Estado de OAuth válido");
  const { access_token: token } = await request("oauth2/token", 200, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", code: callback.searchParams.get("code"), client_id: agentId,
      redirect_uri: redirect, code_verifier: verifier,
    }),
  });

  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    load("mcp", "@modelcontextprotocol/sdk/client/index.js"),
    load("mcp", "@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: `nx19-${name.toLowerCase().replaceAll(" ", "-")}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(mcp, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport, { timeout: 15_000 });
    return { agentId, name, client };
  } catch (error) {
    await client.close();
    throw error;
  }
}
