import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { createMessageRuntime } from "@team-31/message-flow/runtime";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startSideband } from "./sideband.js";
import { createMcpTelemetry } from "./telemetry.js";

vi.mock("./telemetry.js", () => ({ createMcpTelemetry: vi.fn() }));
vi.mock("@team-31/message-flow/runtime", () => ({ createMessageRuntime: vi.fn() }));

const { privateKey } = generateKeyPairSync("ed25519");
const listeners = () => [process.listeners("SIGINT"), process.listeners("SIGTERM")];

beforeEach(() => {
  vi.stubEnv("BROKER_URL", "http://localhost");
  vi.stubEnv("MCP_SERVICE_PRIVATE_KEY", JSON.stringify(privateKey.export({ format: "jwk" })));
  vi.stubEnv("AUTH_ISSUER", "https://issuer.example.test");
  vi.stubEnv("AUTH_JWKS_URL", "https://issuer.example.test/jwks");
  vi.stubEnv("MCP_RESOURCE_URL", "https://mcp.example.test/mcp");
  vi.stubEnv("MCP_HOST", "127.0.0.1");
  vi.stubEnv("SIDEBAND_DEV_USER_ID", "ana");
  vi.stubEnv("SIDEBAND_DEV_AGENT_ID", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["MCP_PORT", "SIDEBAND_DEV_USER_ID", "SIDEBAND_DEV_AGENT_ID"])(
  "rechaza %s antes de crear recursos, incluso al reintentar", async (name) => {
    vi.stubEnv(name, "");
    const before = listeners();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(startSideband(name !== "MCP_PORT", true)).rejects.toThrow(`Revisa el valor de ${name}.`);
      expect(listeners()).toEqual(before);
    }
    expect(createMcpTelemetry).not.toHaveBeenCalled();
    expect(createMessageRuntime).not.toHaveBeenCalled();
  },
);

function observeStartup() {
  const sink = memorySink();
  vi.mocked(createMcpTelemetry).mockImplementation(() => createTelemetry({ service: "mcp", sink }));
  const close = vi.fn().mockResolvedValue(undefined);
  vi.mocked(createMessageRuntime).mockReturnValue({ close, handleMessage: vi.fn(), latestContinuation: vi.fn() });
  return { sink, close };
}

it("cierra el runtime y la telemetría cuando el puerto está ocupado", async () => {
  await using occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto de prueba.");
  vi.stubEnv("MCP_PORT", String(address.port));

  const { sink, close } = observeStartup();
  const before = listeners();
  await expect(startSideband(false, false)).rejects.toMatchObject({ code: "EADDRINUSE" });
  expect(listeners()).toEqual(before);
  expect(close).toHaveBeenCalledOnce();
  expect(sink.find("service.stopping")).toHaveLength(1);
});

it("libera los recursos si falla la conexión stdio al broker", async () => {
  const { sink, close } = observeStartup();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("broker desconectado")));
  const before = listeners();
  await expect(startSideband(true, true)).rejects.toMatchObject({ stage: "transport" });
  expect(listeners()).toEqual(before);
  expect(close).toHaveBeenCalledOnce();
  expect(sink.find("service.stopping")).toHaveLength(1);
});

it("cierra la telemetría si falla la creación del runtime", async () => {
  const { sink } = observeStartup();
  const failure = new Error("fallo al crear el runtime");
  vi.mocked(createMessageRuntime).mockImplementation(() => { throw failure; });
  const before = listeners();
  await expect(startSideband(true, true)).rejects.toBe(failure);
  expect(listeners()).toEqual(before);
  expect(sink.find("service.stopping")).toHaveLength(1);
});
