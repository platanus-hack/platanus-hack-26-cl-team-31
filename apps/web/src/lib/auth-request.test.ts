import { makeSignature } from "better-auth/crypto";
import { expect, it, vi } from "vitest";

import { getOAuthRequest } from "./auth-request";

const secret = "oauth-consent-test-secret";
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ getAuth: () => ({ $context: Promise.resolve({ secret }) }) }));

it("conserva los recursos de la solicitud firmada y presenta cada permiso una vez en el orden solicitado", async () => {
  const resources = ["https://a.example/mcp", "https://b.example/mcp"];
  const clientId = "agente-de-prueba";
  const scope = "sideband:status sideband:ask sideband:status";
  const exp = String(Math.floor(Date.now() / 1000) + 60);
  // Better Auth firma las entradas ordenadas por clave y valor.
  const signed = new URLSearchParams([
    ["client_id", clientId], ["exp", exp],
    ...resources.map((resource) => ["resource", resource]),
    ["scope", scope],
  ]);
  const sig = await makeSignature(signed.toString(), secret);
  signed.append("sig", sig);

  const request = await getOAuthRequest({ client_id: clientId, exp, resource: resources, scope, sig });

  expect(request).toEqual({ clientId, signedQuery: signed.toString(), scopes: ["sideband:status", "sideband:ask"] });
});
