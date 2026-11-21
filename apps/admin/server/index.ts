import { serve } from "@hono/node-server"
import { createTelemetry, tracedFetch, type Telemetry } from "@team-31/telemetry"
import { createPgRevealer } from "./queries/reveal.js"
import { createPgAdminQueries } from "./queries/index.js"
import { createAdminApp } from "./app.js"
import { createPgAuditLog, migrateAdminTables } from "./audit.js"
import { createAdminAuth, createRoleResolver, migrateAdminAuth, type AdminAuthOptions } from "./auth/index.js"
import { createBrokerAdminClient } from "./broker.js"
import { createAdminPool } from "./db.js"
import { allowListFromEnv, readEnv, type AdminEnv } from "./env.js"
import { startPruneTask } from "./prune.js"
import { createAdminLimiters } from "./rate-limit.js"
import { createPgTokenStore } from "./tokens.js"

// Servidor admin: API, auth y MCP. En dev escucha en ADMIN_API_PORT (Vite sirve la SPA en
// ADMIN_PORT); con ADMIN_SERVE_SPA=1 sirve todo en ADMIN_PORT. Ver docs/admin.md#8.

async function start(env: AdminEnv, telemetry: Telemetry, resources: AsyncDisposableStack) {
  const pool = createAdminPool(env.databaseUrl)
  resources.defer(() => pool.end())
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

  const queries = createPgAdminQueries({ databaseUrl: env.readOnlyDatabaseUrl })
  resources.defer(() => queries.close())
  const revealer = createPgRevealer({ databaseUrl: env.databaseUrl })
  resources.defer(() => revealer.close())

  const app = createAdminApp({
    auth,
    roleOf,
    queries,
    revealer,
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
  resources.defer(stopPrune)
  const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, ({ address, port }) => {
    telemetry.emit("service.listening", { attrs: { address, port, serveSpa: env.serveSpa, devAuth: env.devAuth } })
  })

  async function stop() {
    if (shutdown.signal.aborted) return
    shutdown.abort()
    try {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      // Las conexiones keep-alive ociosas se cierran ya; las ocupadas (streams en vivo, que el
      // shutdown ya cortó) tienen unos segundos antes de cerrarse a la fuerza.
      const http = server as { closeIdleConnections?: () => void; closeAllConnections?: () => void }
      http.closeIdleConnections?.()
      const force = setTimeout(() => http.closeAllConnections?.(), 5_000)
      force.unref()
      await closed
      clearTimeout(force)
      await resources.disposeAsync()
    } catch (error) {
      telemetry.error("shutdown", error)
      process.exitCode = 1
    } finally {
      await telemetry.shutdown()
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
  const resources = new AsyncDisposableStack()
  try {
    await start(env, telemetry, resources)
  } catch (error) {
    const errorId = telemetry.error("startup", error)
    const code = (error as { code?: unknown } | null)?.code
    console.error(`[admin] No se pudo iniciar (errorId ${errorId}${typeof code === "string" ? `, ${code}` : ""}).`)
    process.exitCode = 1
    try { await resources.disposeAsync() }
    catch (cleanupError) { telemetry.error("startup.cleanup", cleanupError) }
    await telemetry.shutdown()
  }
}
