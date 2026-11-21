import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const localEnv = fileURLToPath(new URL("../.env.local", import.meta.url));
const envPath = existsSync(localEnv) ? realpathSync(localEnv) : localEnv;
const previous = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const values = parseEnv(previous);
const additions = new Map<string, string>();

function ed25519(name: string) {
  const existing = values[name];
  if (existing) {
    try {
      const key = createPrivateKey({ key: JSON.parse(existing), format: "jwk" });
      if (key.asymmetricKeyType === "ed25519") return key;
    } catch {
      // Report the setting name without printing key material.
    }
    throw new Error(`Revisa ${name} en .env.local. Se requiere una JWK privada Ed25519.`);
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  additions.set(name, JSON.stringify(privateKey.export({ format: "jwk" })));
  return privateKey;
}

function randomKey(name: string) {
  if (!values[name]) additions.set(name, randomBytes(32).toString("base64"));
}

function prepareKeys() {
  if (values.SERVICE_JWT_PUBLIC_KEYS && (!values.MCP_SERVICE_PRIVATE_KEY || !values.WEB_SERVICE_PRIVATE_KEY)) {
    throw new Error("Configura ambas llaves privadas de servicio junto con SERVICE_JWT_PUBLIC_KEYS en .env.local.");
  }
  ed25519("BROKER_SIGNING_KEY");
  const publicKeys = {
    mcp: createPublicKey(ed25519("MCP_SERVICE_PRIVATE_KEY")).export({ format: "jwk" }),
    web: createPublicKey(ed25519("WEB_SERVICE_PRIVATE_KEY")).export({ format: "jwk" }),
  };
  if (values.SERVICE_JWT_PUBLIC_KEYS) {
    for (const [name, exported] of Object.entries(publicKeys)) {
      try {
        const configured = JSON.parse(values.SERVICE_JWT_PUBLIC_KEYS)[name];
        if (configured.kty === exported.kty && configured.crv === exported.crv && configured.x === exported.x && configured.d === undefined) {
          continue;
        }
      } catch {
        // Report only the setting name and issuer.
      }
      throw new Error(`SERVICE_JWT_PUBLIC_KEYS.${name} debe coincidir con su llave privada de servicio.`);
    }
  } else {
    additions.set("SERVICE_JWT_PUBLIC_KEYS", JSON.stringify(publicKeys));
  }
  randomKey("NONCE_KEY");
  randomKey("WAKE_SECRETS_KEY");
  randomKey("BETTER_AUTH_SECRET");
  if (!values.BROKER_DATABASE_PASSWORD) additions.set("BROKER_DATABASE_PASSWORD", randomBytes(32).toString("hex"));
}

function writeKeys() {
  if (additions.size === 0) {
    chmodSync(envPath, 0o600);
    console.log("Llaves locales de Nexo listas.");
    return;
  }
  const temporary = mkdtempSync(join(dirname(envPath), ".nexo-keys-"));
  const entries = Array.from(additions, ([name, value]) => `${name}='${value}'`).join("\n");
  try {
    const output = join(temporary, "env");
    writeFileSync(output, `${previous.trimEnd()}\n\n# Llaves locales de Nexo.\n${entries}\n`, { mode: 0o600 });
    renameSync(output, envPath);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
  console.log("Llaves locales de Nexo generadas en .env.local.");
}

try {
  prepareKeys();
  writeKeys();
} catch (error) {
  console.error(error instanceof Error ? error.message : "No se pudieron preparar las llaves locales de Nexo.");
  process.exitCode = 1;
}
