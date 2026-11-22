import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { POST } from "./route";

const mintDevToken = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/auth", () => ({ getAuth: () => ({ marca: "auth" }) }));
vi.mock("../../../lib/dev-token", () => ({ mintDevToken }));
vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));

function request(body: unknown) {
  return new Request("https://sideband.test/api/dev-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://sideband.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", "https://sideband.test");
  vi.stubEnv("MCP_RESOURCE_URL", "https://sideband.test:8443/mcp");
  mintDevToken.mockReset();
  mintDevToken.mockImplementation(async (_auth: unknown, options: { email: string }) => ({
    userId: `user-${options.email}`,
    clientId: `cliente-${options.email}`,
    accessToken: `token-${options.email}`,
    refreshToken: `refresh-${options.email}`,
    expiresIn: 3600,
    scope: "sideband:ask",
  }));
});

afterEach(() => vi.unstubAllEnvs());

it("no existe sin la bandera", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", undefined);
  expect((await POST(request({ name: "Ana" }))).status).toBe(404);
  expect(mintDevToken).not.toHaveBeenCalled();
});

it("se niega en producción nombrando la variable", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  vi.stubEnv("NODE_ENV", "production");
  await expect(POST(request({ name: "Ana" }))).rejects.toThrow(/SIDEBAND_DEV_AUTH/);
  expect(mintDevToken).not.toHaveBeenCalled();
});

it("entrega un access token para el titular de prueba", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const response = await POST(request({ name: "Ana Prueba" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    email: "ana-prueba@sideband.local",
    accessToken: "token-ana-prueba@sideband.local",
    expiresIn: 3600,
  });
  expect(mintDevToken).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ email: "ana-prueba@sideband.local", name: "Ana Prueba", resource: "https://sideband.test:8443/mcp" }),
  );
});

it("no deja el token en una cookie del navegador", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const response = await POST(request({ name: "Ana" }));
  expect(response.headers.getSetCookie()).toEqual([]);
});

it("da tokens distintos a titulares distintos", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const ana = await (await POST(request({ name: "Ana" }))).json();
  const bob = await (await POST(request({ name: "Bob" }))).json();
  expect(ana.accessToken).not.toBe(bob.accessToken);
  expect(ana.userId).not.toBe(bob.userId);
});

it("rechaza un nombre vacío", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  expect((await POST(request({ name: "  " }))).status).toBe(400);
  expect(mintDevToken).not.toHaveBeenCalled();
});

it("rechaza una petición de otro origen", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const foreign = new Request("https://sideband.test/api/dev-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.test" },
    body: JSON.stringify({ name: "Ana" }),
  });
  expect((await POST(foreign)).status).toBe(403);
  expect(mintDevToken).not.toHaveBeenCalled();
});

it("pasa los scopes pedidos", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  await POST(request({ name: "Ana", scopes: ["sideband:ask"] }));
  expect(mintDevToken).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scopes: ["sideband:ask"] }));
});
