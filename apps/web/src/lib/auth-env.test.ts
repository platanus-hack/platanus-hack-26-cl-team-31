import { afterEach, expect, it, vi } from "vitest";

import { getAuthOptions, getDevAuth } from "./auth-env.mjs";

afterEach(() => vi.unstubAllEnvs());

function stubRequired() {
  vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:54320/app");
  vi.stubEnv("BETTER_AUTH_URL", "https://sideband.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(32));
  vi.stubEnv("MCP_RESOURCE_URL", "https://sideband.test/mcp");
}

it("deja el login de desarrollo apagado por defecto", () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", undefined);
  expect(getDevAuth()).toBe(false);
  stubRequired();
  expect(getAuthOptions().devAuth).toBe(false);
});

it("habilita el login de desarrollo con SIDEBAND_DEV_AUTH=1", () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  expect(getDevAuth()).toBe(true);
});

it("rechaza SIDEBAND_DEV_AUTH en producción al leer el entorno", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  expect(() => getDevAuth()).toThrow("SIDEBAND_DEV_AUTH");
  stubRequired();
  expect(() => getAuthOptions()).toThrow("SIDEBAND_DEV_AUTH");
});
