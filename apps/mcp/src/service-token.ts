import { mintServiceToken } from "@team-31/auth/service";
import type { Principal } from "@team-31/protocol";
import { z } from "zod";

const privateJwk = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.base64url().length(43),
  d: z.base64url().length(43),
});

export function createServiceTokenMinter(value: string | undefined) {
  let privateKey: z.infer<typeof privateJwk>;
  try {
    privateKey = privateJwk.parse(JSON.parse(value ?? ""));
  } catch {
    throw new Error("MCP_SERVICE_PRIVATE_KEY debe contener una JWK privada Ed25519.");
  }

  return function getServiceToken(principal: Principal): Promise<string> {
    return mintServiceToken({
      iss: "mcp",
      sub: principal.userId,
      azp: principal.agentId,
      scopes: principal.scopes,
      privateKey,
    });
  };
}
