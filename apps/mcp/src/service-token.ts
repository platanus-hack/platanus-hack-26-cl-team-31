import { mintServiceToken, parseServicePrivateKey } from "@team-31/auth/service";
import type { Principal } from "@team-31/protocol";

export function createServiceTokenMinter(value: string | undefined) {
  const privateKey = parseServicePrivateKey(value, "mcp");

  return function signServiceToken(principal: Principal): Promise<string> {
    return mintServiceToken({
      iss: "mcp",
      sub: principal.userId,
      azp: principal.agentId,
      scopes: principal.scopes,
      privateKey,
    });
  };
}
