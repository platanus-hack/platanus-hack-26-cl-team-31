import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { mintDevToken } from "./dev-token";

const BASE = "https://sideband.test";
const RESOURCE = "https://sideband.test:8443/mcp";

type Seen = Record<string, unknown>;

/** Better Auth falso con el mismo recorrido del navegador: registro → authorize → consent → token. */
function fakeAuth(seen: Seen, overrides: { authorizeLocation?: string } = {}) {
  return {
    api: {
      devSignIn: async ({ body }: { body: { email: string; name: string } }) => {
        seen.signIn = body;
        return {
          response: { userId: `user-${body.email}` },
          headers: new Headers({ "set-cookie": "better-auth.session_token=galleta; Path=/; HttpOnly" }),
        };
      },
    },
    handler: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/oauth2/register")) {
        seen.register = await request.json();
        return Response.json({ client_id: "cliente-1" }, { status: 201 });
      }
      if (url.pathname.endsWith("/oauth2/authorize")) {
        seen.authorize = Object.fromEntries(url.searchParams);
        seen.authorizeCookie = request.headers.get("cookie");
        const signed = new URLSearchParams(url.searchParams);
        signed.set("sig", "firma");
        return new Response(null, {
          status: 302,
          headers: { Location: overrides.authorizeLocation ?? `/consent?${signed.toString()}` },
        });
      }
      if (url.pathname.endsWith("/oauth2/consent")) {
        seen.consent = await request.json();
        seen.consentCookie = request.headers.get("cookie");
        return Response.json({ redirect: true, url: "http://127.0.0.1/sideband-dev-token?code=codigo&state=abc" });
      }
      if (url.pathname.endsWith("/oauth2/token")) {
        seen.token = Object.fromEntries(new URLSearchParams(await request.text()));
        return Response.json({ access_token: "token-abc", refresh_token: "refresh-abc", expires_in: 3600, scope: "sideband:ask" });
      }
      return new Response("no existe", { status: 404 });
    },
  };
}

function mint(auth: ReturnType<typeof fakeAuth>, scopes?: string[]) {
  return mintDevToken(auth, { baseUrl: BASE, resource: RESOURCE, email: "ana@sideband.local", name: "Ana", scopes });
}

it("recorre el flujo de código de autorización y devuelve el access token", async () => {
  const seen: Seen = {};
  const token = await mint(fakeAuth(seen));

  expect(token).toMatchObject({
    userId: "user-ana@sideband.local",
    clientId: "cliente-1",
    accessToken: "token-abc",
    expiresIn: 3600,
  });
  expect(seen.signIn).toEqual({ email: "ana@sideband.local", name: "Ana" });
  expect(seen.authorizeCookie).toContain("better-auth.session_token=galleta");
  expect(seen.consentCookie).toContain("better-auth.session_token=galleta");
});

it("devuelve al consentimiento la consulta firmada que emitió authorize", async () => {
  const seen: Seen = {};
  await mint(fakeAuth(seen));

  const consent = seen.consent as { accept: boolean; oauth_query: string };
  expect(consent.accept).toBe(true);
  expect(new URLSearchParams(consent.oauth_query).get("sig")).toBe("firma");
});

it("prueba el PKCE con el verificador que generó", async () => {
  const seen: Seen = {};
  await mint(fakeAuth(seen));

  const authorize = seen.authorize as Record<string, string>;
  const token = seen.token as Record<string, string>;
  expect(authorize.code_challenge_method).toBe("S256");
  expect(createHash("sha256").update(token.code_verifier).digest("base64url")).toBe(authorize.code_challenge);
  expect(token).toMatchObject({ grant_type: "authorization_code", code: "codigo", client_id: "cliente-1", resource: RESOURCE });
});

it("pide solo los scopes indicados", async () => {
  const seen: Seen = {};
  await mint(fakeAuth(seen), ["sideband:ask"]);
  expect((seen.authorize as Record<string, string>).scope).toBe("sideband:ask");
});

it("rechaza un scope que no es de Sideband", async () => {
  await expect(mint(fakeAuth({}), ["sideband:todo"])).rejects.toThrow(/scope/i);
});

it("falla cuando authorize no lleva al consentimiento", async () => {
  const seen: Seen = {};
  const auth = fakeAuth(seen, { authorizeLocation: "/api/auth/error?error=invalid_request" });
  await expect(mint(auth)).rejects.toThrow(/consent/i);
});
