// STUB del contrato. Lo implementa ADM-05 (docs/admin.md): MCP de administración de solo
// lectura en POST /mcp, autenticado con tokens nxa_.
import type { Hono } from "hono"
import type { AdminTokenScope } from "../../shared/contract.js"
import type { AdminQueries } from "../../shared/queries.js"

export type TokenPrincipal = { tokenId: string; label: string; createdBy: string; scopes: AdminTokenScope[] }

export type AdminMcpDeps = {
  queries: AdminQueries
  // Devuelve null si el token no existe, venció o fue revocado. Lo implementa ADM-04.
  authenticate(bearer: string): Promise<TokenPrincipal | null>
  audit(entry: { actor: TokenPrincipal; action: string; target: string | null }): Promise<void>
}

export function mountAdminMcp(_app: Hono, _deps: AdminMcpDeps): void {
  // ADM-05 registra aquí la ruta POST /mcp.
}
