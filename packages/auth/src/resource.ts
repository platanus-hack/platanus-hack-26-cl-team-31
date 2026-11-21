import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { Principal, Scope } from "@team-31/protocol";
import { APIError } from "better-auth/api";
import { createInMemoryDpopReplayStore } from "better-auth/oauth2";

import { parseScopes } from "./scopes.js";

type McpGuardOptions = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  devAuth?: boolean;
};

type Handler = (principal: Principal) => Response | Promise<Response>;

export function createMcpGuard({ issuer, audience, jwksUrl, devAuth = false }: McpGuardOptions) {
  if (devAuth && process.env.NODE_ENV === "production") {
    throw new Error("MCP_DEV_AUTH no se puede activar en producción.");
  }

  const replayStore = createInMemoryDpopReplayStore();

  return async (request: Request, handler: Handler): Promise<Response> => {
    if (devAuth) {
      const token = /^Bearer dev:([^:\s]+):([^:\s]+)$/i.exec(request.headers.get("Authorization") ?? "");
      if (token?.[1] && token[2]) {
        return handler({ userId: token[1], agentId: token[2], scopes: [...Scope.options] });
      }
    }

    const verify = createMcpProtectedRequestHandler(
      {
        issuer,
        audience,
        jwksUrl,
        jwtVerifyOptions: { typ: "at+jwt", requiredClaims: ["sub", "azp", "exp"] },
        dpop: { replayStore },
      },
      (_request, claims) => {
        const principal = Principal.safeParse({
          userId: claims.sub,
          agentId: claims.azp,
          scopes: parseScopes(claims.scope),
        });
        if (principal.success && principal.data.userId.trim() && principal.data.agentId.trim()) {
          return handler(principal.data);
        }

        const message = "El token de acceso no contiene una identidad válida.";
        const challenge = createResourceServerChallenge(new APIError("UNAUTHORIZED", { message }), audience);
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
          { status: 401, headers: challenge?.headers },
        );
      },
    );
    return verify(request);
  };
}
