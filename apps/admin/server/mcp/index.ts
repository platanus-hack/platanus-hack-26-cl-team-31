// MCP de administración de solo lectura (ADM-05, docs/admin.md sección 6). POST /mcp con
// Streamable HTTP sin estado: un McpServer y un transporte por request, autenticado con
// tokens sba_ (Authorization: Bearer) y limitado a 60 req/min por token.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js"
import type { Telemetry } from "@team-31/telemetry"
import type { Context, Hono } from "hono"
import { createRateLimiter } from "@team-31/auth/rate-limit"
import { ADMIN_TOKEN_PREFIX } from "../../shared/contract.js"
import { createAdminMcpServer } from "./server.js"
import type { AdminMcpDeps, TokenPrincipal } from "./types.js"

export const MCP_PATH = "/mcp"
export const MCP_RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

function rpcError(c: Context, status: 401 | 405 | 429 | 500, code: number, message: string, headers: Record<string, string> = {}) {
  return c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, { "Cache-Control": "no-store", ...headers })
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")
  const token = match?.[1]
  return token && token.startsWith(ADMIN_TOKEN_PREFIX) ? token : null
}

export function mountAdminMcp(
  app: Hono,
  deps: AdminMcpDeps,
  telemetry: Telemetry,
): void {
  const rateLimit = createRateLimiter({ limit: MCP_RATE_LIMIT, windowMs: RATE_WINDOW_MS })

  app.post(MCP_PATH, async (c) => {
    const token = bearerToken(c.req.header("authorization"))
    let principal: TokenPrincipal | null
    try {
      principal = token ? await deps.authenticate(token) : null
    } catch (error) {
      const errorId = telemetry.error("admin.mcp.authenticate", error)
      return rpcError(c, 500, ErrorCode.InternalError, "No se pudo verificar el token.", { "X-Error-Id": errorId })
    }
    if (!principal) {
      telemetry.emit("auth.token.rejected", { attrs: { issuer: "admin", reason: token ? "invalid_token" : "missing_token" } })
      return rpcError(c, 401, -32001, token ? "Token inválido, vencido o revocado." : `Falta Authorization: Bearer ${ADMIN_TOKEN_PREFIX}….`, {
        "WWW-Authenticate": token ? 'Bearer realm="sideband-admin", error="invalid_token"' : 'Bearer realm="sideband-admin"',
      })
    }
    telemetry.emit("auth.token.verified", { attrs: { issuer: "admin" } })

    const limited = rateLimit.consume(principal.tokenId)
    if (limited) {
      telemetry.emit("http.rate_limited", { attrs: { route: MCP_PATH, bucket: "admin_mcp" } })
      return rpcError(c, 429, -32002, `Límite de ${MCP_RATE_LIMIT} solicitudes por minuto por token alcanzado.`, {
        "Retry-After": String(limited.retryAfter),
      })
    }

    const server = createAdminMcpServer(principal, deps, telemetry)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(c.req.raw)
      response.headers.set("Cache-Control", "no-store")
      return response
    } catch (error) {
      const errorId = telemetry.error("admin.mcp.request", error)
      return rpcError(c, 500, ErrorCode.InternalError, "No se pudo procesar la solicitud MCP.", { "X-Error-Id": errorId })
    } finally {
      // Con enableJsonResponse la respuesta ya está completa: se puede cerrar el servidor.
      try {
        await server.close()
      } catch (error) {
        telemetry.error("admin.mcp.close", error)
      }
    }
  })

  app.all(MCP_PATH, (c) =>
    rpcError(c, 405, -32000, "Método no permitido: este MCP es sin estado y solo acepta POST.", { Allow: "POST" }),
  )
}
