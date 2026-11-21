// Mintea un access token de MCP para un titular de prueba sin navegador, recorriendo en el proceso
// el mismo flujo de código de autorización que haría una persona: registro dinámico del cliente,
// /oauth2/authorize, /oauth2/consent y /oauth2/token. No hay atajo ni firma propia: el token sale
// del emisor real y el MCP lo verifica por JWKS como cualquier otro.
//
// La pieza que faltaba era el consentimiento: el proveedor guarda la solicitud pendiente en estado
// por petición (defineRequestState), no en una cookie, y la repuebla desde el cuerpo `oauth_query`
// —la consulta firmada que /oauth2/authorize dejó en el Location de /consent—. Es lo mismo que
// manda el cliente del navegador desde window.location.search.
//
// Solo lo llama POST /api/dev-token, que existe únicamente con SIDEBAND_DEV_AUTH=1.
import { createHash, randomBytes } from "node:crypto";

import { Scope } from "@team-31/protocol";

/** Nunca se usa: el código se lee de la respuesta del consentimiento, sin pasar por la red. */
const REDIRECT_URI = "http://127.0.0.1/sideband-dev-token";

export type DevAuth = {
  api: {
    devSignIn: (input: { body: { email: string; name: string }; returnHeaders: true }) => Promise<{
      response: { userId: string };
      headers: Headers;
    }>;
  };
  handler: (request: Request) => Promise<Response>;
};

export type DevTokenOptions = {
  baseUrl: string;
  resource: string;
  email: string;
  name: string;
  scopes?: string[];
};

export type DevToken = {
  userId: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
};

function fail(step: string, detail: string): never {
  // Nunca lleva cookies, códigos ni tokens: solo el paso y el motivo.
  throw new Error(`El token de desarrollo falló en ${step}: ${detail}`);
}

/** Convierte los Set-Cookie de la sesión en el encabezado Cookie que leerán authorize y consent. */
function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

type Call = (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;

function clientName(name: string): string {
  return `Titular de prueba ${name}`;
}

/**
 * El client_id que este mismo endpoint ya registró para el titular, si existe. Se reconoce por su
 * client_name: un cliente que la persona conectó desde el navegador tiene otras redirect_uris y
 * reusarlo haría fallar la autorización. Entre varios propios gana el más antiguo, que es el que
 * quedó en la conexión de agente del broker: el broker no admite una segunda viva por titular.
 */
async function reusableClient(call: Call, cookie: string, options: DevTokenOptions, scopes: string[]) {
  const response = await call("/oauth2/get-consents", { method: "GET", cookie });
  if (!response.ok) return undefined;
  const consents = (await response.json()) as { clientId?: string; scopes?: string[]; createdAt?: string }[];
  const candidates = consents
    .filter((consent) => consent.clientId && scopes.every((scope) => consent.scopes?.includes(scope)))
    .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));

  for (const candidate of candidates) {
    const client = await call(`/oauth2/public-client?client_id=${encodeURIComponent(candidate.clientId!)}`, {
      method: "GET",
      cookie,
    });
    if (!client.ok) continue;
    const { client_name: found } = (await client.json()) as { client_name?: string };
    if (found === clientName(options.name)) return candidate.clientId;
  }
  return undefined;
}

async function registerClient(call: Call, name: string): Promise<string> {
  const registered = await call("/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName(name),
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });
  if (!registered.ok) fail("el registro del cliente", `HTTP ${registered.status}`);
  const client = (await registered.json()) as { client_id?: string };
  if (!client.client_id) fail("el registro del cliente", "la respuesta no trae client_id");
  return client.client_id;
}

export async function mintDevToken(auth: DevAuth, options: DevTokenOptions): Promise<DevToken> {
  const scopes = options.scopes ?? [...Scope.options];
  const unknown = scopes.filter((scope) => !(Scope.options as readonly string[]).includes(scope));
  if (unknown.length) fail("los scopes", `scope desconocido ${unknown.join(", ")}`);

  const origin = new URL(options.baseUrl).origin;
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("Origin", origin);
    if (cookie) headers.set("Cookie", cookie);
    return auth.handler(new Request(`${options.baseUrl}/api/auth${path}`, { ...rest, headers, redirect: "manual" }));
  };

  const session = await auth.api.devSignIn({ body: { email: options.email, name: options.name }, returnHeaders: true });
  const cookie = cookieHeader(session.headers);

  // El broker solo admite una conexión de agente viva por titular, y el agentId es el client_id.
  // Registrar un cliente nuevo en cada token dejaría al titular con un agentId que su conexión ya
  // no reconoce, así que se reusa el cliente que ese titular ya consintió, como un navegador que
  // vuelve: entonces authorize entrega el código sin volver a pedir el consentimiento.
  const clientId = await reusableClient(call, cookie, options, scopes) ?? await registerClient(call, options.name);

  const verifier = randomBytes(32).toString("base64url");
  const authorizeQuery = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    resource: options.resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(16).toString("base64url"),
  });
  const authorized = await call(`/oauth2/authorize?${authorizeQuery.toString()}`, { method: "GET", cookie });
  const location = authorized.headers.get("location");
  if (!location) fail("la autorización", `HTTP ${authorized.status} sin redirección`);
  const [path, signedQuery] = location.split("?");

  let redirectUrl: string;
  if (location.startsWith(REDIRECT_URI)) {
    // El consentimiento vigente cubre los scopes: authorize entrega el código de una vez.
    redirectUrl = location;
  } else if (path.endsWith("/consent") && signedQuery) {
    const consented = await call("/oauth2/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cookie,
      body: JSON.stringify({ accept: true, oauth_query: signedQuery }),
    });
    if (!consented.ok) fail("el consentimiento", `HTTP ${consented.status}`);
    const redirect = (await consented.json()) as { url?: string };
    if (!redirect.url) fail("el consentimiento", "la respuesta no trae la redirección");
    redirectUrl = redirect.url;
  } else {
    // El titular ya tiene sesión: cualquier otro destino (/sign-in, /api/auth/error) significa
    // que la solicitud no era válida.
    fail("la autorización", `no llevó al consent (${path})`);
  }

  const code = new URL(redirectUrl).searchParams.get("code");
  if (!code) fail("la autorización", "la redirección no trae el código");

  const exchanged = await call("/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: options.resource,
    }).toString(),
  });
  if (!exchanged.ok) fail("el canje del código", `HTTP ${exchanged.status}`);
  const token = (await exchanged.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!token.access_token) fail("el canje del código", "la respuesta no trae access_token");

  return {
    userId: session.response.userId,
    clientId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    scope: token.scope,
  };
}
