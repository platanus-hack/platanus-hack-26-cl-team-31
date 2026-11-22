import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
// En CI, cargar la CLI con tsx puede tomar más de 15 s mientras corren los demás paquetes.
const startupTimeoutMs = 60_000;
const testTimeoutMs = startupTimeoutMs + 5_000;

async function expectStartupFailure(env: NodeJS.ProcessEnv, args: string[], diagnostic: string) {
  const startup = execute(process.execPath, ["--conditions=@team-31/source", "--import", "tsx", entry, ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { PATH: process.env.PATH, TELEMETRY_SINK: "off", ...env },
    timeout: startupTimeoutMs,
    killSignal: "SIGKILL",
  });
  await expect(startup).rejects.toMatchObject({
    code: 1, stdout: "", stderr: `[sideband-mcp] ${diagnostic}\n`,
  });
}

it("rechaza la autenticación de desarrollo en producción antes de configurar el transporte", async () => {
  await expectStartupFailure({ NODE_ENV: "production", MCP_DEV_AUTH: "1" }, ["--stdio"],
    "MCP_DEV_AUTH no se puede activar en producción.");
}, testTimeoutMs);

it("requiere autenticación de desarrollo al seleccionar stdio", async () => {
  await expectStartupFailure({}, ["--stdio"], "Error de arranque. El modo stdio requiere MCP_DEV_AUTH=1.");
}, testTimeoutMs);

it("acepta stdio en desarrollo e identifica la variable inválida sin imprimir su valor", async () => {
  await expectStartupFailure({ MCP_DEV_AUTH: "1", BROKER_URL: "valor-privado-de-prueba" }, ["--stdio"],
    "Error de arranque. Revisa el valor de BROKER_URL.");
}, testTimeoutMs);

it("identifica una clave de servicio mal configurada sin mostrar su contenido", async () => {
  await expectStartupFailure({ BROKER_URL: "http://localhost", MCP_SERVICE_PRIVATE_KEY: "valor-de-prueba" }, [],
    "Error de arranque. MCP_SERVICE_PRIVATE_KEY debe contener una JWK privada Ed25519.");
}, testTimeoutMs);

it("presenta un diagnóstico genérico si el puerto HTTP está ocupado", async () => {
  await using occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto de prueba.");
  const origin = `http://127.0.0.1:${address.port}`;
  const { privateKey } = generateKeyPairSync("ed25519");
  await expectStartupFailure({
    MCP_PORT: String(address.port),
    BROKER_URL: origin,
    MCP_SERVICE_PRIVATE_KEY: JSON.stringify(privateKey.export({ format: "jwk" })),
    MCP_RESOURCE_URL: `${origin}/mcp`,
    AUTH_ISSUER: origin,
    AUTH_JWKS_URL: `${origin}/jwks`,
  }, [], "Error de arranque. Revisa la configuración y la disponibilidad del puerto.");
}, testTimeoutMs);
