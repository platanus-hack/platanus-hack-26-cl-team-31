import { describe, expect, it } from "vitest";
import { readOAuthConfig } from "./oauth-config.js";

const config = {
  NODE_ENV: "production",
  MCP_RESOURCE_URL: "https://mcp.example/mcp",
  AUTH_ISSUER: "https://auth.example",
  AUTH_JWKS_URL: "https://auth.example/keys",
};

describe("MCP OAuth configuration", () => {
  it("preserves the exact production issuer and audience", () => {
    expect(readOAuthConfig(config)).toEqual({
      issuer: config.AUTH_ISSUER, audience: config.MCP_RESOURCE_URL, jwksUrl: config.AUTH_JWKS_URL,
    });
  });
  it.each(["MCP_RESOURCE_URL", "AUTH_ISSUER", "AUTH_JWKS_URL"] as const)(
    "rejects plaintext and credentials in %s without logging its value", (name) => {
      for (const url of [config[name].replace("https:", "http:"), "https://user:secret@auth.example/mcp"]) {
        expect(() => readOAuthConfig({ ...config, [name]: url }))
          .toThrow(new Error(`Revisa el valor de ${name}.`));
      }
    },
  );
  it("accepts local HTTP for development", () => {
    const url = "http://127.0.0.1/mcp";
    expect(readOAuthConfig({ ...config, NODE_ENV: "development", MCP_RESOURCE_URL: url }).audience).toBe(url);
  });
});
