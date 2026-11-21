import { mintServiceToken } from "@team-31/auth/service"
import type { AdminActor } from "@team-31/protocol"
import type { JWK } from "jose"
import { AdminHttpError } from "./errors.js"

// Cliente del AdminPort del broker (/v1/admin/*). Las mutaciones operativas nunca escriben
// la base directo: el broker mantiene sus invariantes. Ver docs/admin.md (ADM-03).
// Cada llamada lleva un JWT de servicio EdDSA iss=admin, aud=broker, 60 s, sub = id del
// admin y claim email, firmado con ADMIN_SERVICE_PRIVATE_KEY.

export type { AdminActor }

export interface BrokerAdminClient {
  rewake(actor: AdminActor, requestId: string, reason: string): Promise<void>
  expire(actor: AdminActor, requestId: string, reason: string): Promise<void>
  revokeAgent(actor: AdminActor, userId: string, agentId: string, reason: string): Promise<void>
}

const TIMEOUT_MS = 10_000

export function createBrokerAdminClient({ baseUrl, privateKey, fetch = globalThis.fetch }: {
  baseUrl: string | undefined
  privateKey: JWK | undefined
  // tracedFetch(telemetry) en producción para propagar traceparent.
  fetch?: typeof globalThis.fetch
}): BrokerAdminClient {
  async function call(actor: AdminActor, path: string, reason: string) {
    if (!baseUrl || !privateKey) {
      throw new AdminHttpError("upstream", "El broker no está configurado (BROKER_URL y ADMIN_SERVICE_PRIVATE_KEY).")
    }
    const token = await mintServiceToken({ iss: "admin", sub: actor.adminId, email: actor.email, privateKey })
    let response: Response
    try {
      response = await fetch(new URL(path, baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new AdminHttpError("upstream", "No se pudo contactar al broker.")
    }
    if (response.ok) return
    const code = await response.json().then((body: unknown) => (body as { error?: { code?: unknown } } | null)?.error?.code, () => undefined)
    if (response.status === 404) throw new AdminHttpError("not_found", "El broker no encontró el recurso.")
    // 409 conflict: la solicitud ya no admite la acción (p. ej. ya está cerrada).
    if (response.status === 400 || response.status === 409 || response.status === 410) {
      throw new AdminHttpError("invalid_input", `El broker rechazó la acción${typeof code === "string" ? ` (${code})` : ""}.`)
    }
    // 401/403: el broker no reconoce la llave del admin (SERVICE_JWT_PUBLIC_KEYS.admin).
    throw new AdminHttpError("upstream", `El broker respondió ${response.status}.`)
  }

  const segment = encodeURIComponent
  return {
    rewake: (actor, requestId, reason) => call(actor, `/v1/admin/requests/${segment(requestId)}/rewake`, reason),
    expire: (actor, requestId, reason) => call(actor, `/v1/admin/requests/${segment(requestId)}/expire`, reason),
    revokeAgent: (actor, userId, agentId, reason) =>
      call(actor, `/v1/admin/agents/${segment(userId)}/${segment(agentId)}/revoke`, reason),
  }
}
