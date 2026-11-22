import { mcp } from "@better-auth/mcp";
import { Scope } from "@team-31/protocol";
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";
import { z } from "zod";

export { oauthProviderAuthServerMetadata as createAuthServerMetadata } from "@better-auth/oauth-provider";

type AuthOptions = {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  mcpResource: string;
  /** SIDEBAND_DEV_AUTH: agrega el endpoint devSignIn. Prohibido en producción. */
  devAuth?: boolean;
};

// Endpoint solo de servidor (nunca se registra en /api/auth/*): crea si falta e inicia sesión como
// un titular de prueba, para levantar N identidades sin N cuentas de Google. Solo lo monta
// createAuth con devAuth, y solo lo llama POST /api/dev-login (SIDEBAND_DEV_AUTH=1).
// El consentimiento no se salta: únicamente cambia cómo el humano demuestra quién es.
const devSignInPlugin = () => ({
  id: "sideband-dev-sign-in",
  endpoints: {
    devSignIn: createAuthEndpoint.serverOnly(
      { method: "POST", body: z.object({ email: z.email(), name: z.string().min(1).max(100) }) },
      async (ctx) => {
        const email = ctx.body.email.toLowerCase();
        const { internalAdapter } = ctx.context;
        const user = (await internalAdapter.findUserByEmail(email))?.user
          ?? await internalAdapter.createUser({ email, name: ctx.body.name, emailVerified: true }, ctx);
        const session = await internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ userId: user.id });
      },
    ),
  },
}) satisfies BetterAuthPlugin;

function authConfig({ databaseUrl, baseUrl, secret, google, mcpResource, devAuth = false }: AuthOptions) {
  const identityScopes = ["openid", "profile", "email", "offline_access"];

  return {
    appName: "Sideband",
    database: new Pool({ connectionString: databaseUrl }),
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret,
    socialProviders: google ? { google } : {},
    user: {
      additionalFields: {
        // Misma columna que el plugin phoneNumber de Better Auth, sin sus rutas de login por SMS.
        // input: false impide que un cliente se asigne el teléfono de otra persona.
        phoneNumber: { type: "string", required: false, unique: true, input: false, returned: false },
      },
    },
    disabledPaths: ["/token"],
    telemetry: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/oauth2/authorize") return;

        const input = context.method === "POST" ? "body" : "query";
        const params = context[input];
        // El proveedor usa todos los scopes del cliente si se omite scope.
        return {
          context: {
            [input]: {
              ...params,
              scope: params?.scope ?? Scope.options.join(" "),
              resource: params?.resource ?? mcpResource,
            },
          },
        };
      }),
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResource,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        scopes: [...identityScopes, ...Scope.options],
        clientRegistrationDefaultScopes: [...Scope.options],
        clientRegistrationAllowedScopes: identityScopes,
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn: 3600,
        refreshTokenReuseInterval: 0,
      }),
      ...(devAuth ? [devSignInPlugin()] : []),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(options: AuthOptions) {
  if (options.devAuth && process.env.NODE_ENV === "production") {
    throw new Error("SIDEBAND_DEV_AUTH no se puede activar en producción.");
  }
  return betterAuth(authConfig(options));
}

export async function migrateAuth(options: AuthOptions): Promise<void> {
  const config = authConfig(options);
  try {
    const migration = await getMigrations(config);
    await migration.runMigrations();
  } finally {
    await config.database.end();
  }
}
