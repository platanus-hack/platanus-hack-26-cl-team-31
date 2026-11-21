// MCP de administración de solo lectura (ADM-05, docs/admin.md sección 6). POST /mcp con
// Streamable HTTP sin estado: un McpServer y un transporte por request, autenticado con
// tokens nxa_ (Authorization: Bearer) y limitado a 60 req/min por token.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"
import type { Context, Hono } from "hono"
import type { AdminTokenScope } from "../../shared/contract.js"
import type { AdminQueries } from "../../shared/queries.js"
import { createRateLimiter } from "./rate-limit.js"
import { createAdminMcpServer } from "./server.js"

export type TokenPrincipal = { tokenId: string; label: string; createdBy: string; scopes: AdminTokenScope[] }

export type AdminMcpDeps = {
  queries: AdminQueries
  // Devuelve null si el token no existe, venció o fue revocado. Lo implementa ADM-04.
  authenticate(bearer: string): Promise<TokenPrincipal | null>
  audit(entry: { actor: TokenPrincipal; action: string; target: string | null }): Promise<void>
}

export const MCP_PATH = "/mcp"
export const MCP_RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const TOKEN_PREFIX = "nxa_"

function rpcError(c: Context, status: 401 | 405 | 429 | 500, code: number, message: string, headers: Record<string, string> = {}) {
  return c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, { "Cache-Control": "no-store", ...headers })
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")
  const token = match?.[1]
  return token && token.startsWith(TOKEN_PREFIX) ? token : null
}

export function mountAdminMcp(app: Hono, deps: AdminMcpDeps): void {
  const rateLimit = createRateLimiter(MCP_RATE_LIMIT, RATE_WINDOW_MS)

  app.post(MCP_PATH, async (c) => {
    const token = bearerToken(c.req.header("authorization"))
    let principal: TokenPrincipal | null
    try {
      principal = token ? await deps.authenticate(token) : null
    } catch {
      // TODO(admin): telemetry.error("mcp admin authenticate", error) y X-Error-Id al conectar @team-31/telemetry en admin.
      return rpcError(c, 500, ErrorCode.InternalError, "No se pudo verificar el token.")
    }
    if (!principal) {
      // TODO(admin): emit("auth.token.rejected", { attrs: { issuer: "admin", reason } }) al conectar @team-31/telemetry en admin.
      return rpcError(c, 401, -32001, token ? "Token inválido, vencido o revocado." : "Falta Authorization: Bearer nxa_….", {
        "WWW-Authenticate": token ? 'Bearer realm="nexo-admin", error="invalid_token"' : 'Bearer realm="nexo-admin"',
      })
    }

    const limited = rateLimit(principal.tokenId)
    if (!limited.ok) {
      // TODO(admin): emit("http.rate_limited", { attrs: { route: "/mcp", bucket: "admin_mcp" } }) al conectar @team-31/telemetry en admin.
      return rpcError(c, 429, -32002, `Límite de ${MCP_RATE_LIMIT} solicitudes por minuto por token alcanzado.`, {
        "Retry-After": String(limited.retryAfterSeconds),
      })
    }

    const server = createAdminMcpServer(principal, deps)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(c.req.raw)
      response.headers.set("Cache-Control", "no-store")
      return response
    } catch {
      // TODO(admin): telemetry.error("mcp admin request", error) y X-Error-Id al conectar @team-31/telemetry en admin.
      return rpcError(c, 500, ErrorCode.InternalError, "No se pudo procesar la solicitud MCP.")
    } finally {
      // Con enableJsonResponse la respuesta ya está completa: se puede cerrar el servidor.
      void server.close().catch(() => undefined)
    }
  })

  app.all(MCP_PATH, (c) =>
    rpcError(c, 405, -32000, "Método no permitido: este MCP es sin estado y solo acepta POST.", { Allow: "POST" }),
  )
}
