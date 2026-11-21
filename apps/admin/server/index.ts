import { serve } from "@hono/node-server"
import { createTelemetry, tracedFetch, type Telemetry } from "@team-31/telemetry"
import type { AdminQueries } from "../shared/queries.js"
import { createPgAdminQueries } from "./queries/index.js"
import { createAdminApp } from "./app.js"
import { createPgAuditLog, migrateAdminTables } from "./audit.js"
import { createAdminAuth, createRoleResolver, migrateAdminAuth, type AdminAuthOptions } from "./auth/index.js"
import { createBrokerAdminClient } from "./broker.js"
import { createAdminPool } from "./db.js"
import { allowListFromEnv, readEnv, type AdminEnv } from "./env.js"
import { AdminHttpError } from "./errors.js"
import { startPruneTask } from "./prune.js"
import { createAdminLimiters } from "./rate-limit.js"
import { createPgTokenStore } from "./tokens.js"
import type { Revealer } from "./types.js"

// Servidor admin: API, auth y MCP. En dev escucha en ADMIN_API_PORT (Vite sirve la SPA en
// ADMIN_PORT); con ADMIN_SERVE_SPA=1 sirve todo en ADMIN_PORT. Ver docs/admin.md#8.

// AdminQueries lo implementa ADM-02. Mientras sea un stub, la API responde `upstream`.
function loadQueries(databaseUrl: string): AdminQueries {
  try {
    return createPgAdminQueries({ databaseUrl })
  } catch {
    console.warn("[admin] AdminQueries aún no está disponible (ADM-02). Las lecturas responderán 502.")
    return new Proxy({} as AdminQueries, {
      get: () => async () => {
        throw new AdminHttpError("upstream", "Las consultas del admin aún no están disponibles.")
      },
    })
  }
}

// createPgRevealer vive en server/queries/reveal.ts (ADM-02). Se carga dinámicamente para
// que el build pase aunque el módulo todavía no exista.
async function loadRevealer(databaseUrl: string): Promise<Revealer> {
  const specifier = "./queries/reveal.js"
  try {
    const module = (await import(specifier)) as { createPgRevealer?: (options: { databaseUrl: string }) => Revealer }
    if (typeof module.createPgRevealer === "function") return module.createPgRevealer({ databaseUrl })
  } catch {
    // Aún no existe.
  }
  console.warn("[admin] El revelado de payloads aún no está disponible (ADM-02).")
  return {
    reveal: async () => {
      throw new AdminHttpError("upstream", "Revelar payloads aún no está disponible.")
    },
  }
}

async function start(env: AdminEnv, telemetry: Telemetry) {
  const pool = createAdminPool(env.databaseUrl)
  await migrateAdminTables(pool)
  const audit = createPgAuditLog(pool, telemetry)
  const roleOf = createRoleResolver(allowListFromEnv(process.env), { devAuth: env.devAuth })
  const authOptions: AdminAuthOptions = {
    pool,
    baseUrl: env.adminUrl,
    secret: env.authSecret,
    google: env.google,
    roleOf,
    freshSeconds: env.freshSeconds,
    onLogin: async (user) => {
      await audit.record({ actor: { type: "admin", id: user.id, label: user.email }, action: "login", target: null })
    },
  }
  // En producción el esquema se migra con `admin:auth:migrate`; en dev, al iniciar.
  if (!env.production) await migrateAdminAuth(authOptions)
  const auth = createAdminAuth(authOptions)
  const tokens = createPgTokenStore(pool)
  const shutdown = new AbortController()

  const app = createAdminApp({
    auth,
    roleOf,
    queries: loadQueries(env.readOnlyDatabaseUrl),
    revealer: await loadRevealer(env.databaseUrl),
    tokens,
    authenticateToken: (bearer) => tokens.authenticate(bearer),
    audit,
    broker: createBrokerAdminClient({ baseUrl: env.brokerUrl, privateKey: env.servicePrivateKey, fetch: tracedFetch(telemetry) }),
    telemetry,
    limiters: createAdminLimiters(),
    adminUrl: env.adminUrl,
    freshSeconds: env.freshSeconds,
    devAuth: env.devAuth,
    trustProxy: env.trustProxy,
    serveSpa: env.serveSpa,
    live: { shutdown: shutdown.signal },
  })

  const stopPrune = startPruneTask(pool, env.retentionDays, telemetry)
  const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, ({ address, port }) => {
    console.info(`[admin] escuchando en ${address}:${port}${env.serveSpa ? " (SPA + API + MCP)" : " (API + MCP)"}`)
    if (env.devAuth) console.info("[admin] ADMIN_DEV_AUTH=1: POST /api/admin/dev-login habilitado")
  })

  async function stop() {
    if (shutdown.signal.aborted) return
    shutdown.abort()
    stopPrune()
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await pool.end()
      await telemetry.shutdown()
    } catch (error) {
      telemetry.error("shutdown", error)
      process.exitCode = 1
    }
  }

  server.on("error", (error) => {
    telemetry.error("http.listen", error)
    process.exitCode = 1
    void stop()
  })
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}

let env: AdminEnv | undefined
try {
  env = readEnv(process.env)
} catch (error) {
  console.error("[admin]", error instanceof Error ? error.message : "Configuración inválida.")
  process.exitCode = 1
}

if (env) {
  // service.started, latido cada 30 s y sink según TELEMETRY_SINK (postgres por defecto con DATABASE_URL).
  const telemetry = createTelemetry({ service: "admin", version: process.env.npm_package_version ?? "0.0.1" })
  try {
    await start(env, telemetry)
  } catch (error) {
    const errorId = telemetry.error("startup", error)
    const code = (error as { code?: unknown } | null)?.code
    console.error(`[admin] No se pudo iniciar (errorId ${errorId}${typeof code === "string" ? `, ${code}` : ""}).`)
    process.exitCode = 1
    await telemetry.shutdown()
  }
}
