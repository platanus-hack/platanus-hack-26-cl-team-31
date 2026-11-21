import { ed25519PrivateKey } from "@team-31/auth/service"
import { createHash } from "node:crypto"
import { ed25519PrivateKey } from "@team-31/auth/service"
import { z } from "zod"

// Configuración del servidor admin. Ver docs/admin.md (secciones 4 y 8) y .env.local.example.
const flag = z.enum(["0", "1"]).default("0").transform((value) => value === "1")
const optional = (value: unknown) => (value === "" ? undefined : value)
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ })

const privateKeyJson = z.string().transform((value, ctx) => {
  try {
    const parsed = ed25519PrivateKey.safeParse(JSON.parse(value))
    if (parsed.success) return parsed.data
  } catch {
    // Sin imprimir el material de la llave.
  }
  ctx.addIssue({ code: "custom", message: "Se requiere una JWK privada Ed25519 en JSON." })
  return z.NEVER
})

const settings = z
  .object({
    NODE_ENV: z.string().optional(),
    ADMIN_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
    ADMIN_PORT: z.coerce.number().int().min(1).max(65_535).default(4400),
    ADMIN_API_PORT: z.coerce.number().int().min(1).max(65_535).default(4450),
    ADMIN_SERVE_SPA: flag,
    ADMIN_URL: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
    DATABASE_URL: z.preprocess(optional, postgresUrl.optional()),
    // Producción: rol con el esquema admin y sideband_admin_reveal. Si falta, DATABASE_URL.
    ADMIN_DATABASE_URL: z.preprocess(optional, postgresUrl.optional()),
    // Producción: rol miembro de sideband_admin_ro. Si falta, ADMIN_DATABASE_URL.
    ADMIN_DATABASE_URL_RO: z.preprocess(optional, postgresUrl.optional()),
    ADMIN_AUTH_SECRET: z.preprocess(optional, z.string().min(32).optional()),
    BETTER_AUTH_SECRET: z.preprocess(optional, z.string().optional()),
    ADMIN_GOOGLE_CLIENT_ID: z.preprocess(optional, z.string().optional()),
    ADMIN_GOOGLE_CLIENT_SECRET: z.preprocess(optional, z.string().optional()),
    ADMIN_DEV_AUTH: flag,
    ADMIN_FRESH_SECONDS: z.coerce.number().int().min(30).max(86_400).default(600),
    ADMIN_TRUST_PROXY: flag,
    ADMIN_SERVICE_PRIVATE_KEY: z.preprocess(optional, privateKeyJson.optional()),
    BROKER_URL: z.preprocess(optional, z.url({ protocol: /^https?$/ }).optional()),
    TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === "production"
    if (production && env.ADMIN_DEV_AUTH) {
      ctx.addIssue({ code: "custom", path: ["ADMIN_DEV_AUTH"], message: "No se permite en producción." })
    }
    if (!env.DATABASE_URL && !env.ADMIN_DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["ADMIN_DATABASE_URL"], message: "Se requiere ADMIN_DATABASE_URL o DATABASE_URL." })
    }
    if (!env.ADMIN_AUTH_SECRET && (production || !env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["ADMIN_AUTH_SECRET"], message: "Se requiere un secreto de al menos 32 caracteres." })
    }
    if (Boolean(env.ADMIN_GOOGLE_CLIENT_ID) !== Boolean(env.ADMIN_GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["ADMIN_GOOGLE_CLIENT_SECRET"], message: "Configura ADMIN_GOOGLE_CLIENT_ID y ADMIN_GOOGLE_CLIENT_SECRET juntos." })
    }
  })
  .transform((env) => {
    const databaseUrl = (env.ADMIN_DATABASE_URL ?? env.DATABASE_URL) as string
    return {
      production: env.NODE_ENV === "production",
      host: env.ADMIN_HOST,
      // En producción un solo proceso sirve SPA, API y MCP en ADMIN_PORT.
      port: env.ADMIN_SERVE_SPA ? env.ADMIN_PORT : env.ADMIN_API_PORT,
      serveSpa: env.ADMIN_SERVE_SPA,
      adminUrl: env.ADMIN_URL,
      databaseUrl,
      readOnlyDatabaseUrl: env.ADMIN_DATABASE_URL_RO ?? databaseUrl,
      // Fuera de producción se deriva de BETTER_AUTH_SECRET para no exigir otra llave local.
      authSecret: env.ADMIN_AUTH_SECRET ?? createHash("sha256").update(`sideband-admin:${env.BETTER_AUTH_SECRET}`).digest("base64url"),
      google: env.ADMIN_GOOGLE_CLIENT_ID && env.ADMIN_GOOGLE_CLIENT_SECRET
        ? { clientId: env.ADMIN_GOOGLE_CLIENT_ID, clientSecret: env.ADMIN_GOOGLE_CLIENT_SECRET }
        : undefined,
      devAuth: env.ADMIN_DEV_AUTH,
      freshSeconds: env.ADMIN_FRESH_SECONDS,
      trustProxy: env.ADMIN_TRUST_PROXY,
      servicePrivateKey: env.ADMIN_SERVICE_PRIVATE_KEY,
      brokerUrl: env.BROKER_URL,
      retentionDays: env.TELEMETRY_RETENTION_DAYS,
    }
  })

export type AdminEnv = z.output<typeof settings>

export function readEnv(input: NodeJS.ProcessEnv): AdminEnv {
  const result = settings.safeParse(input)
  if (result.success) return result.data
  const issues = result.error.issues.map(({ path, code, message }) => {
    const explanation = code === "custom" ? message : "Falta el valor o el formato no es válido."
    return `${path.join(".")} — ${explanation}`
  })
  throw new Error(`Configuración inválida del admin. ${issues.join(" ")}`)
}

// Lista blanca de correos. Se lee en cada request: quitar un correo revoca el acceso
// en el siguiente request sin reiniciar nada que dependa de la sesión.
export type AllowList = () => { operators: string[]; viewers: string[] }

const emails = (value: string | undefined) =>
  (value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)

export function allowListFromEnv(source: NodeJS.ProcessEnv = process.env): AllowList {
  return () => ({ operators: emails(source.ADMIN_OPERATORS), viewers: emails(source.ADMIN_VIEWERS) })
}
