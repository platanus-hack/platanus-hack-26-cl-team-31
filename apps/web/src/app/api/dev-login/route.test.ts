import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { POST } from "./route";

const devSignIn = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/auth", () => ({ getAuth: () => ({ api: { devSignIn } }) }));
vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));

function request(body: unknown) {
  return new Request("https://sideband.test/api/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://sideband.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", "https://sideband.test");
  devSignIn.mockReset();
  devSignIn.mockImplementation(async ({ body }: { body: { email: string } }) => ({
    response: { userId: `user-${body.email}` },
    headers: new Headers({ "set-cookie": `better-auth.session_token=token-${body.email}; Path=/; HttpOnly` }),
  }));
});

afterEach(() => vi.unstubAllEnvs());

it("no existe sin la bandera", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", undefined);
  expect((await POST(request({ name: "Ana" }))).status).toBe(404);
  expect(devSignIn).not.toHaveBeenCalled();
});

it("crea y autentica un titular de prueba con la bandera activa", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const response = await POST(request({ name: "Ana" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ email: "ana@sideband.local" });
  expect(response.headers.getSetCookie()[0]).toContain("better-auth.session_token=");
  expect(devSignIn).toHaveBeenCalledWith(expect.objectContaining({
    body: { email: "ana@sideband.local", name: "Ana" },
  }));
});

it("dos titulares de prueba distintos no comparten sesión", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const ana = await POST(request({ name: "Ana" }));
  const bob = await POST(request({ name: "Bob" }));
  expect(await ana.json()).not.toEqual(await bob.json());
  expect(ana.headers.getSetCookie()[0]).not.toBe(bob.headers.getSetCookie()[0]);
});

it("rechaza un nombre vacío", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  expect((await POST(request({ name: "  " }))).status).toBe(400);
  expect(devSignIn).not.toHaveBeenCalled();
});

it("rechaza una petición de otro origen", async () => {
  vi.stubEnv("SIDEBAND_DEV_AUTH", "1");
  const foreign = new Request("https://sideband.test/api/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.test" },
    body: JSON.stringify({ name: "Ana" }),
  });
  expect((await POST(foreign)).status).toBe(403);
  expect(devSignIn).not.toHaveBeenCalled();
});
