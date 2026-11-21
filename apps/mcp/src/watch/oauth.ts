import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { WAKE_SUBSCRIPTION_SCOPE } from "@team-31/protocol";
import { deferred } from "./deferred.js";
import { listen } from "./listener.js";

// Separate, ephemeral loopback listener: the webhook tunnel never serves OAuth callbacks.
export async function authorize(serverUrl: URL, signal: AbortSignal, showUrl: (url: URL) => void) {
  const scope = `${WAKE_SUBSCRIPTION_SCOPE} offline_access`;
  const state = randomBytes(32).toString("base64url");
  const callback = deferred<string | null>();
  const oauth = await listen((req, res) => {
    if (req.method !== "GET" || req.url?.split("?", 1)[0] !== "/callback") return res.writeHead(404).end();
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("state") !== state) return res.writeHead(400).end("Estado OAuth inválido.");
    const code = url.searchParams.get("error") ? null : url.searchParams.get("code");
    res.writeHead(code ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
      .end(code ? "Vuelve a la terminal para continuar." : "No se autorizó el acceso.", () => callback.resolve(code));
  });
  const redirectUrl = new URL("/callback", oauth.origin);
  let client: Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
  let tokens: Awaited<ReturnType<OAuthClientProvider["tokens"]>>;
  let discovery: Awaited<ReturnType<NonNullable<OAuthClientProvider["discoveryState"]>>>;
  let verifier = "";
  const provider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: {
      client_name: "Sideband Terminal",
      redirect_uris: [redirectUrl.href],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      scope,
    },
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (value) => { client = value; },
    tokens: () => tokens,
    saveTokens: (value) => { tokens = value; },
    discoveryState: () => discovery,
    saveDiscoveryState: (value) => { discovery = value; },
    redirectToAuthorization: showUrl,
    codeVerifier: () => verifier,
    saveCodeVerifier: (value) => { verifier = value; },
  };
  const wait = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  const cancel = () => callback.resolve(null);
  wait.addEventListener("abort", cancel, { once: true });
  try {
    if (wait.aborted) cancel();
    const fetchFn: typeof fetch = (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([wait, AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]),
    });
    await auth(provider, { serverUrl, scope, fetchFn });
    const code = await callback.promise;
    if (!code) throw new Error("No se completó la autorización OAuth.");
    await auth(provider, { serverUrl, scope, authorizationCode: code, fetchFn });
    // Refresh can still use the SDK. If consent is needed again, restart the watcher.
    provider.redirectToAuthorization = () => { throw new Error("La autorización venció. Ejecuta sideband watch de nuevo."); };
    return provider;
  } finally {
    wait.removeEventListener("abort", cancel);
    await oauth.close();
  }
}
