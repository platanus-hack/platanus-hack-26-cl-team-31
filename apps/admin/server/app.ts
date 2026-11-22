import { fileURLToPath } from "node:url"
import { serveStatic } from "@hono/node-server/serve-static"
import { honoTelemetry } from "@team-31/telemetry/hono"
import { Hono, type Context } from "hono"
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

function notFound(c: Context) {
  return c.json(ErrorBody.parse({ error: { code: "not_found", message: "No se encontró la ruta." } }), 404)
}

function setSpaCacheControl(path: string, c: Context) {
  // Assets con hash: caché larga. index.html: siempre revalidar.
  c.header("Cache-Control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache")
}

function createAdminMcpDeps(deps: AdminAppDeps): AdminMcpDeps {
  return {
    queries: deps.queries,
    async authenticate(bearer) {
      const principal = await deps.authenticateToken(bearer)
      if (!principal) return null
      const role = deps.roleOf(principal.createdBy)
      if (!role) return null
      if (role === "viewer" && principal.scopes.includes("admin:sql")) {
        return { ...principal, scopes: ["admin:read"] }
      }
      return principal
    },
    async audit({ actor, action, target }) {
      await deps.audit.record({ actor: { type: "token", id: actor.tokenId, label: actor.label }, action, target })
    },
  }
}

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

  mountAdminMcp(app, createAdminMcpDeps(deps), deps.telemetry, deps.adminUrl)

  if (deps.serveSpa) {
    const root = deps.spaRoot ?? fileURLToPath(new URL("../../client/", import.meta.url))
    app.all("/api/*", notFound)
    app.get("*", serveStatic({ root, onFound: setSpaCacheControl }))
    app.get("*", serveStatic({ root, path: "index.html", onFound: setSpaCacheControl }))
  }
  app.notFound(notFound)
  return app
}
