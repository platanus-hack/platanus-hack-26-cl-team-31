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

/**
 * SIDEBAND_DEV_AUTH=1 habilita el login de desarrollo (`POST /api/dev-login`): crea e inicia
 * sesión como un titular de prueba sin Google, para levantar N identidades sin N cuentas.
 * Se rechaza al leer el entorno cuando NODE_ENV=production, igual que ADMIN_DEV_AUTH.
 */
export function getDevAuth() {
  const enabled = process.env.SIDEBAND_DEV_AUTH === "1";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error("SIDEBAND_DEV_AUTH no se permite en producción.");
  }
  return enabled;
}

export function getAuthOptions() {
  return {
    databaseUrl: required("DATABASE_URL"),
    baseUrl: getAuthBaseUrl(),
    secret: required("BETTER_AUTH_SECRET"),
    google: getGoogleOptions(),
    mcpResource: required("MCP_RESOURCE_URL"),
    devAuth: getDevAuth(),
  };
}

/** Identificador del recurso MCP: es la audiencia que el MCP exige en el access token. */
export function getMcpResource() {
  return required("MCP_RESOURCE_URL");
}
