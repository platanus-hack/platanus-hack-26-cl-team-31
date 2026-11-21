export function readOAuthConfig(env: NodeJS.ProcessEnv) {
  function endpoint(name: string) {
    const value = env[name]?.trim();
    const url = value ? URL.parse(value) : null;
    if (!url || url.username || url.password || url.hash || url.search ||
        !(url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:"))) {
      throw new Error(`Revisa el valor de ${name}.`);
    }
    return url;
  }
  const resource = endpoint("MCP_RESOURCE_URL");
  if (resource.pathname !== "/mcp") throw new Error("MCP_RESOURCE_URL debe apuntar a /mcp.");

  // Keep exact identifiers: OAuth compares audience and issuer as strings.
  endpoint("AUTH_ISSUER");
  endpoint("AUTH_JWKS_URL");
  return {
    audience: env.MCP_RESOURCE_URL!.trim(),
    issuer: env.AUTH_ISSUER!.trim(),
    jwksUrl: env.AUTH_JWKS_URL!.trim(),
  };
}
