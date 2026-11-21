import { spawn, spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";

function required(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Falta ${name}.`);
  return value;
}

function dbUrl(name, password) {
  const url = new URL(required("DATABASE_URL"));
  url.username = name;
  url.password = encodeURIComponent(required(password));
  return url.href;
}

function publicJwk(name) {
  try {
    const key = createPrivateKey({ key: JSON.parse(required(name)), format: "jwk" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    return createPublicKey(key).export({ format: "jwk" });
  } catch {
    throw new Error(`${name} debe contener una JWK privada Ed25519.`);
  }
}

function migrate(file, env) {
  const result = spawnSync(process.execPath, [file], { env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Falló ${file}.`);
}

function start() {
  const url = new URL(required("RENDER_EXTERNAL_URL"));
  if (url.protocol !== "https:" || url.href !== `${url.origin}/`) {
    throw new Error("RENDER_EXTERNAL_URL debe ser un origen HTTPS.");
  }
  const common = { PATH: process.env.PATH, NODE_ENV: "production" };
  const auth = {
    BETTER_AUTH_URL: url.origin,
    BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
    MCP_RESOURCE_URL: `${url.origin}/mcp`,
  };
  if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) {
    auth.GOOGLE_CLIENT_ID = required("GOOGLE_CLIENT_ID");
    auth.GOOGLE_CLIENT_SECRET = required("GOOGLE_CLIENT_SECRET");
  }
  const broker = {
    BROKER_PORT: required("BROKER_PORT"),
    BROKER_SIGNING_KEY: required("BROKER_SIGNING_KEY"),
    NONCE_KEY: required("NONCE_KEY"),
    WAKE_SECRETS_KEY: required("WAKE_SECRETS_KEY"),
    SERVICE_JWT_PUBLIC_KEYS: JSON.stringify({
      mcp: publicJwk("MCP_SERVICE_PRIVATE_KEY"),
      web: publicJwk("WEB_SERVICE_PRIVATE_KEY"),
    }),
    DATABASE_URL: dbUrl("nexo_broker_runtime", "BROKER_DB_PASSWORD"),
  };
  const brokerUrl = `http://127.0.0.1:${broker.BROKER_PORT}`;
  const mcp = {
    MCP_PORT: required("MCP_PORT"),
    MCP_RESOURCE_URL: auth.MCP_RESOURCE_URL,
    AUTH_ISSUER: `${url.origin}/api/auth`,
    AUTH_JWKS_URL: `${url.origin}/api/auth/jwks`,
    BROKER_URL: brokerUrl,
    MCP_SERVICE_PRIVATE_KEY: required("MCP_SERVICE_PRIVATE_KEY"),
  };
  const web = {
    ...auth,
    BROKER_URL: brokerUrl,
    WEB_SERVICE_PRIVATE_KEY: required("WEB_SERVICE_PRIVATE_KEY"),
    DATABASE_URL: dbUrl("nexo_web_runtime", "WEB_DB_PASSWORD"),
    RENDER: "true",
    MCP_PORT: mcp.MCP_PORT,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const port = required("PORT");

  migrate("apps/web/scripts/migrate-auth.mjs", { ...common, ...auth, DATABASE_URL: required("DATABASE_URL") });
  migrate("packages/broker/scripts/init-render-db.mjs", {
    ...common,
    DATABASE_URL: required("DATABASE_URL"),
    BROKER_DB_PASSWORD: required("BROKER_DB_PASSWORD"),
    WEB_DB_PASSWORD: required("WEB_DB_PASSWORD"),
  });

  const children = new Set();
  let stopping = false;
  function stop(exitCode) {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    for (const child of children) child.kill("SIGTERM");
    const deadline = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, 10_000);
    deadline.unref();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(0));
  function launch(name, args, env, cwd) {
    const child = spawn(process.execPath, args, { env: { ...common, ...env }, cwd, stdio: "inherit" });
    children.add(child);
    child.once("close", () => {
      children.delete(child);
      if (!stopping) {
        console.error(`[render] ${name} se detuvo.`);
        stop(1);
      }
    });
    child.once("error", () => stop(1));
  }
  launch("broker", ["apps/broker/dist/index.js"], broker);
  launch("MCP", ["apps/mcp/dist/index.js"], mcp);
  launch("web", ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", port], web, "apps/web");
}

try {
  start();
} catch (error) {
  console.error(`[render] ${error instanceof Error ? error.message : "Falló el arranque."}`);
  process.exitCode = 1;
}
