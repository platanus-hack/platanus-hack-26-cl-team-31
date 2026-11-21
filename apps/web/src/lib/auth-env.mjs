function required(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Falta configurar ${name} para la autenticación de Sideband.`);
  }
  return value;
}

export function getGoogleOptions() {
  if (!process.env.GOOGLE_CLIENT_ID?.trim() && !process.env.GOOGLE_CLIENT_SECRET?.trim()) return undefined;
  return { clientId: required("GOOGLE_CLIENT_ID"), clientSecret: required("GOOGLE_CLIENT_SECRET") };
}

export function getAuthBaseUrl() {
  return required("BETTER_AUTH_URL");
}

export function getAuthOptions() {
  return {
    databaseUrl: required("DATABASE_URL"),
    baseUrl: getAuthBaseUrl(),
    secret: required("BETTER_AUTH_SECRET"),
    google: getGoogleOptions(),
    mcpResource: required("MCP_RESOURCE_URL"),
  };
}
