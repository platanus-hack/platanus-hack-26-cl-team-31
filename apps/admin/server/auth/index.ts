import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { getMigrations } from "better-auth/db/migration"
import type pg from "pg"
import { z } from "zod"
import type { AdminRole } from "../../shared/contract.js"
import type { AllowList } from "../env.js"

// Better Auth propio del admin: instancia, esquema (`admin`, vía search_path del pool) y
// cookie (`sideband-admin.*`) separados de los de apps/web. Ver docs/admin.md#4-sesiones-y-acceso.

export const DEV_EMAIL = "dev@sideband.local"
const SESSION_TTL_SECONDS = 8 * 3600
const SESSION_UPDATE_AGE_SECONDS = 15 * 60

export type RoleResolver = (email: string) => AdminRole | null

// El rol nunca se guarda: se calcula en cada request desde la lista blanca.
export function createRoleResolver(allowList: AllowList, { devAuth }: { devAuth: boolean }): RoleResolver {
  return (email) => {
    const normalized = email.trim().toLowerCase()
    if (devAuth && normalized === DEV_EMAIL) return "operator"
    const { operators, viewers } = allowList()
    if (operators.includes(normalized)) return "operator"
    if (viewers.includes(normalized)) return "viewer"
    return null
  }
}

export type AdminAuthOptions = {
  pool: pg.Pool
  baseUrl: string
  secret: string
  google?: { clientId: string; clientSecret: string }
  roleOf: RoleResolver
  freshSeconds: number
  onLogin?: (user: { id: string; email: string }) => Promise<void>
}

// Endpoint solo de servidor (nunca se registra en /api/auth/*): crea una sesión para un correo
// autorizado. Lo usan POST /api/admin/dev-login (ADMIN_DEV_AUTH=1) y las pruebas.
const issueSessionPlugin = () => ({
  id: "sideband-admin-issue-session",
  endpoints: {
    issueSession: createAuthEndpoint.serverOnly(
      { method: "POST", body: z.object({ email: z.email(), name: z.string().min(1).max(100) }) },
      async (ctx) => {
        const email = ctx.body.email.toLowerCase()
        const { internalAdapter } = ctx.context
        const user = (await internalAdapter.findUserByEmail(email))?.user
          ?? await internalAdapter.createUser({ email, name: ctx.body.name, emailVerified: true }, { method: "admin" })
        const session = await internalAdapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ userId: user.id })
      },
    ),
  },
}) satisfies BetterAuthPlugin

function adminAuthConfig({ pool, baseUrl, secret, google, roleOf, freshSeconds, onLogin }: AdminAuthOptions) {
  const forbidden = () => new APIError("FORBIDDEN", { message: "Este correo no tiene acceso al admin de Sideband." })
  return {
    appName: "Sideband Admin",
    database: pool,
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [baseUrl],
    telemetry: { enabled: false },
    socialProviders: google ? { google: { ...google, prompt: "select_account" as const } } : {},
    // Sin email y contraseña: solo Google (y dev login fuera de producción).
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: freshSeconds,
      // Sin caché de cookie: revocar una sesión surte efecto en el siguiente request.
      cookieCache: { enabled: false },
    },
    advanced: { cookiePrefix: "sideband-admin" },
    onAPIError: { errorURL: `${baseUrl}/login` },
    databaseHooks: {
      user: {
        create: {
          // Correos fuera de la lista blanca: 403 y no se crea el usuario.
          before: async (user) => {
            if (!user.emailVerified || !roleOf(user.email)) throw forbidden()
            return { data: user }
          },
        },
      },
      session: {
        create: {
          // Un usuario que ya existía pero salió de la lista tampoco obtiene sesión.
          before: async (session) => {
            const { rows } = await pool.query<{ email: string }>('SELECT email FROM admin."user" WHERE id = $1', [session.userId])
            const email = rows[0]?.email
            if (!email || !roleOf(email)) throw forbidden()
            return { data: session }
          },
          after: async (session) => {
            if (!onLogin) return
            const { rows } = await pool.query<{ email: string }>('SELECT email FROM admin."user" WHERE id = $1', [session.userId])
            if (rows[0]) await onLogin({ id: session.userId, email: rows[0].email })
          },
        },
      },
    },
    plugins: [issueSessionPlugin()],
  } satisfies BetterAuthOptions
}

export function createAdminAuth(options: AdminAuthOptions) {
  return betterAuth(adminAuthConfig(options))
}

export type AdminAuth = ReturnType<typeof createAdminAuth>

// Crea o actualiza las tablas de Better Auth en el esquema `admin`.
export async function migrateAdminAuth(options: AdminAuthOptions): Promise<void> {
  await options.pool.query("CREATE SCHEMA IF NOT EXISTS admin")
  const migration = await getMigrations(adminAuthConfig(options))
  await migration.runMigrations()
}
