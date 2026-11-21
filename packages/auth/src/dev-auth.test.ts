// Login de desarrollo: crea e inicia sesión como un titular de prueba sin Google.
// La guarda sigue la forma de MCP_DEV_AUTH (resource.ts) y ADMIN_DEV_AUTH (apps/admin/server/env.ts).
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth, migrateAuth } from "./server.js";

const schema = `dev_auth_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool | undefined;
let options: Parameters<typeof createAuth>[0];
let devAuth: ReturnType<typeof createAuth> | undefined;
let plainAuth: ReturnType<typeof createAuth> | undefined;

beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Ejecuta pnpm bootstrap para configurar TEST_DATABASE_URL.");

  admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const authDb = new URL(databaseUrl);
  authDb.searchParams.set("options", `-c search_path=${schema}`);

  options = {
    databaseUrl: authDb.href,
    baseUrl: "http://127.0.0.1:3000",
    secret: randomBytes(32).toString("base64url"),
    mcpResource: "http://127.0.0.1:4100/mcp",
  };
  await migrateAuth(options);
  plainAuth = createAuth(options);
  devAuth = createAuth({ ...options, devAuth: true });
}, 15_000);

afterAll(async () => {
  await plainAuth?.options.database.end();
  await devAuth?.options.database.end();
  if (admin) {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

function sessionCookie(headers: Headers): string | undefined {
  return headers.getSetCookie().find((cookie) => cookie.startsWith("better-auth.session_token="));
}

describe("login de desarrollo", () => {
  it("rechaza SIDEBAND_DEV_AUTH en producción", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => createAuth({ ...options, devAuth: true })).toThrow("SIDEBAND_DEV_AUTH");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("no registra el endpoint de dev-login sin la bandera", () => {
    expect(plainAuth?.api.devSignIn).toBeUndefined();
  });

  it("crea y autentica un titular de prueba con la bandera activa", async () => {
    const email = `ana-${randomUUID()}@sideband.local`;
    const first = await devAuth!.api.devSignIn({ body: { email, name: "Ana" }, returnHeaders: true });
    expect(first.response.userId).toMatch(/\S/);
    expect(sessionCookie(first.headers)).toBeDefined();

    // Create-if-missing: el segundo inicio reutiliza el mismo titular.
    const again = await devAuth!.api.devSignIn({ body: { email, name: "Ana" }, returnHeaders: true });
    expect(again.response.userId).toBe(first.response.userId);

    const { rows } = await admin!.query(`SELECT id FROM ${schema}."user" WHERE email = $1`, [email]);
    expect(rows).toEqual([{ id: first.response.userId }]);
  });

  it("dos titulares de prueba distintos no comparten sesión", async () => {
    const ana = await devAuth!.api.devSignIn({
      body: { email: `ana-${randomUUID()}@sideband.local`, name: "Ana" }, returnHeaders: true,
    });
    const bob = await devAuth!.api.devSignIn({
      body: { email: `bob-${randomUUID()}@sideband.local`, name: "Bob" }, returnHeaders: true,
    });

    expect(bob.response.userId).not.toBe(ana.response.userId);
    expect(sessionCookie(bob.headers)).not.toBe(sessionCookie(ana.headers));

    for (const [headers, userId] of [[ana.headers, ana.response.userId], [bob.headers, bob.response.userId]] as const) {
      const cookie = sessionCookie(headers)!.split(";")[0]!;
      const session = await devAuth!.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe(userId);
    }
  });
});
