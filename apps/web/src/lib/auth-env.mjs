function required(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Falta configurar ${name} para la autenticación de Nexo.`);
  }
  return value;
}

export function getAuthOptions() {
  return {
    databaseUrl: required("DATABASE_URL"),
    baseUrl: required("BETTER_AUTH_URL"),
    secret: required("BETTER_AUTH_SECRET"),
    google: {
      clientId: required("GOOGLE_CLIENT_ID"),
      clientSecret: required("GOOGLE_CLIENT_SECRET"),
    },
    mcpResource: required("MCP_RESOURCE_URL"),
  };
}
