import type { AdminTokenScope } from "../../shared/contract.js"
import type { AdminQueries } from "../../shared/queries.js"

export type TokenPrincipal = { tokenId: string; label: string; createdBy: string; scopes: AdminTokenScope[] }

export type AdminMcpDeps = {
  queries: AdminQueries
  // Devuelve null si el token no existe, venció o fue revocado. Lo implementa ADM-04.
  authenticate(bearer: string): Promise<TokenPrincipal | null>
  audit(entry: { actor: TokenPrincipal; action: string; target: string | null }): Promise<void>
}
