import { ok } from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Scope } from "@team-31/protocol";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { testUtils } from "better-auth/plugins";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpGuard } from "./resource.js";
import { createAuth, createAuthServerMetadata, migrateAuth } from "./server.js";

const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
const Registration = z.object({ client_id: z.string(), application_type: z.literal("native") });
const Redirect = z.object({ url: z.string().min(1) });
const Token = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
let admin: Pool | undefined;
let auth: ReturnType<typeof createAuth> | undefined;
let baseUrl: string;
let issuer: string;
let audience: string;
let redirectUri: string;
let userId: string;
let sessionHeaders: Headers;
const server = createServer();

beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Ejecuta pnpm bootstrap para configurar TEST_DATABASE_URL.");

  admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const authDb = new URL(databaseUrl);
  authDb.searchParams.set("options", `-c search_path=${schema}`);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = `${baseUrl}/api/auth`;
  audience = `${baseUrl}/mcp`;
  redirectUri = `${baseUrl}/callback`;
  const options = {
    databaseUrl: authDb.href,
    baseUrl,
    secret: randomBytes(32).toString("base64url"),
    google: { clientId: "google-client-for-tests", clientSecret: "google-secret-for-tests" },
    mcpResource: audience,
  };

  await migrateAuth(options);
  auth = createAuth(options);

  const metadata = createAuthServerMetadata(auth);
  const handler = auth.handler;
  server.on("request", toNodeHandler((request) =>
    new URL(request.url).pathname === "/.well-known/oauth-authorization-server"
      ? metadata(request)
      : handler(request),
  ));

  const testAuth = betterAuth({ ...auth.options, plugins: [testUtils()] });
  const { test } = await testAuth.$context;
  const user = await test.saveUser(test.createUser());
  userId = user.id;
  sessionHeaders = (await test.login({ userId })).headers;
}, 15_000);

afterAll(async () => {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await auth?.options.database.end();
  if (admin) {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

describe("servidor OAuth de Better Auth con Postgres", () => {
  it("publica metadata OAuth y JWKS", async () => {
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/auth"]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        registration_endpoint: `${issuer}/oauth2/register`,
        jwks_uri: `${issuer}/jwks`,
        scopes_supported: expect.arrayContaining(["openid", "profile", "email", "offline_access", ...Scope.options]),
      });
    }
    const jwks = await fetch(`${issuer}/jwks`);
    expect(jwks.status).toBe(200);
    expect(await jwks.json()).toMatchObject({
      keys: [expect.objectContaining({ kid: expect.any(String), x: expect.any(String) })],
    });
  });

  it.each([
    { label: "por GET y con los permisos Sideband por defecto", method: "GET", scope: undefined },
    { label: "por POST y con los permisos Sideband por defecto", method: "POST", scope: undefined },
    { label: "con acceso sin conexión", method: "GET", scope: [...Scope.options, "offline_access"].join(" ") },
  ])("emite un access token verificable $label", async ({ method, scope }) => {
    const register = await fetch(`${issuer}/oauth2/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Agente de prueba",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
      }),
    });
    expect(register.status).toBe(201);
    const client = Registration.parse(await register.json());

    const codeVerifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
      state: randomUUID(),
    });
    if (scope) query.set("scope", scope);

    const authHeaders = new Headers(sessionHeaders);
    authHeaders.set("Accept", "application/json");
    authHeaders.set("Origin", baseUrl);
    const authorize = await fetch(`${issuer}/oauth2/authorize${method === "GET" ? `?${query}` : ""}`, {
      method,
      headers: authHeaders,
      body: method === "POST" ? query : undefined,
    });
    expect(authorize.status).toBe(200);
    const consentUrl = new URL(Redirect.parse(await authorize.json()).url, baseUrl);
    expect(consentUrl.pathname).toBe("/consent");
    expect(consentUrl.searchParams.get("scope")).toBe(scope ?? Scope.options.join(" "));

    const headers = new Headers(sessionHeaders);
    headers.set("Origin", baseUrl);
    headers.set("Content-Type", "application/json");
    const consent = await fetch(`${issuer}/oauth2/consent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    });
    expect(consent.status).toBe(200);
    const callback = new URL(Redirect.parse(await consent.json()).url);
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe(query.get("state"));
    const code = callback.searchParams.get("code");
    ok(code);

    const exchange = await fetch(`${issuer}/oauth2/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    expect(exchange.status).toBe(200);
    const token = Token.parse(await exchange.json());
    expect(token.expires_in).toBe(3600);
    expect(decodeProtectedHeader(token.access_token).typ).toBe("at+jwt");
    expect(decodeJwt(token.access_token)).toMatchObject({
      iss: issuer,
      aud: audience,
      sub: userId,
      azp: client.client_id,
      scope: scope ?? Scope.options.join(" "),
    });

    const guard = createMcpGuard({ issuer, audience, jwksUrl: `${issuer}/jwks` });
    const response = await guard(
      new Request(audience, { headers: { Authorization: `Bearer ${token.access_token}` } }),
      (principal) => Response.json(principal),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId, agentId: client.client_id, scopes: Scope.options });

    if (scope) {
      ok(token.refresh_token);
      const refresh = await fetch(`${issuer}/oauth2/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: client.client_id,
        }),
      });
      expect(refresh.status).toBe(200);
      const rotated = Token.parse(await refresh.json());
      ok(rotated.refresh_token);
      expect(rotated.refresh_token).not.toBe(token.refresh_token);
      expect(decodeJwt(rotated.access_token)).toMatchObject({ iss: issuer, aud: audience, sub: userId, azp: client.client_id });
    }
  });
});
