import { mcp } from "@better-auth/mcp";
import { Scope } from "@team-31/protocol";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

export { oauthProviderAuthServerMetadata as createAuthServerMetadata } from "@better-auth/oauth-provider";

type AuthOptions = {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  mcpResource: string;
};

function authConfig({ databaseUrl, baseUrl, secret, google, mcpResource }: AuthOptions) {
  const identityScopes = ["openid", "profile", "email", "offline_access"];

  return {
    database: new Pool({ connectionString: databaseUrl }),
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret,
    socialProviders: { google },
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
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(options: AuthOptions) {
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
