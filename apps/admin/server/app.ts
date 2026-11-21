import { fileURLToPath } from "node:url"
import { serveStatic } from "@hono/node-server/serve-static"
import { honoTelemetry } from "@team-31/telemetry/hono"
import { Hono } from "hono"
import { secureHeaders } from "hono/secure-headers"
import { ErrorBody } from "../shared/contract.js"
import { createAdminApi, loginRateLimit, type AdminApiDeps } from "./api.js"
import { mountAdminMcp } from "./mcp/index.js"
import type { AdminMcpDeps } from "./mcp/types.js"

// Composición del servidor admin: /healthz, Better Auth en /api/auth/*, API en /api/admin/*,
// MCP en /mcp y, en producción (ADMIN_SERVE_SPA=1), la SPA de dist/client.

export type AdminAppDeps = AdminApiDeps & {
  authenticateToken: AdminMcpDeps["authenticate"]
  serveSpa: boolean
  // Carpeta de la SPA compilada. Por defecto dist/client junto a dist/server.
  spaRoot?: string
}

const defaultSpaRoot = () => fileURLToPath(new URL("../../client/", import.meta.url))

export function createAdminApp(deps: AdminAppDeps) {
  const app = new Hono()
  app.use(honoTelemetry(deps.telemetry))
  app.use(secureHeaders({ crossOriginResourcePolicy: "same-origin", referrerPolicy: "same-origin" }))

  app.get("/healthz", (c) => {
    c.header("Cache-Control", "no-store")
    return c.json({ ok: true, service: "admin" })
  })

  app.use("/api/auth/sign-in/*", loginRateLimit(deps.limiters, deps.trustProxy, deps.telemetry))
  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    c.header("Cache-Control", "no-store")
    return deps.auth.handler(c.req.raw)
  })

  app.route("/", createAdminApi(deps))

  mountAdminMcp(app, {
    queries: deps.queries,
    authenticate: (bearer) => deps.authenticateToken(bearer),
    audit: async ({ actor, action, target }) => {
      await deps.audit.record({ actor: { type: "token", id: actor.tokenId, label: actor.label }, action, target })
    },
  }, deps.telemetry, deps.adminUrl)

  const notFound = () => ErrorBody.parse({ error: { code: "not_found", message: "No se encontró la ruta." } })
  if (deps.serveSpa) {
    const root = deps.spaRoot ?? defaultSpaRoot()
    app.all("/api/*", (c) => c.json(notFound(), 404))
    // Assets con hash: caché larga. index.html: siempre revalidar.
    const onFound = (path: string, c: { header: (name: string, value: string) => void }) => {
      c.header("Cache-Control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache")
    }
    app.get("*", serveStatic({ root, onFound }))
    app.get("*", serveStatic({ root, path: "index.html", onFound }))
  }
  app.notFound((c) => c.json(notFound(), 404))
  return app
}
