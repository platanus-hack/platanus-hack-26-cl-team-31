import { Scope } from "@team-31/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpGuard } from "./resource.js";

const audience = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test/api/auth";
const options = { audience, issuer, jwksUrl: `${issuer}/jwks` };

afterEach(() => vi.unstubAllEnvs());

describe("autorización de MCP", () => {
  it("construye el Principal a partir del token de desarrollo", async () => {
    const guard = createMcpGuard({ ...options, devAuth: true });
    const response = await guard(
      new Request(audience, { headers: { Authorization: "Bearer dev:user-1:agent-1" } }),
      (principal) => Response.json(principal),
    );

    expect(await response.json()).toEqual({ userId: "user-1", agentId: "agent-1", scopes: Scope.options });
  });

  it("impide habilitar tokens de desarrollo en producción", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createMcpGuard({ ...options, devAuth: true })).toThrow("MCP_DEV_AUTH");
  });

  it.each([undefined, "Bearer dev:user:agent", "Bearer invalido"])(
    "envía el desafío RFC 9728 con credenciales ausentes o inválidas (%s)",
    async (authorization) => {
      const guard = createMcpGuard(options);
      const handler = vi.fn();
      const response = await guard(
        new Request(audience, { headers: authorization ? { Authorization: authorization } : undefined }),
        handler,
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toContain(
        'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
      );
      expect(handler).not.toHaveBeenCalled();
    },
  );
});
