import { mintServiceToken } from "@team-31/auth/service"
import { BrokerError, createAdminClient, type AdminPort } from "@team-31/broker/client"
import type { JWK } from "jose"
import { AdminHttpError } from "./errors.js"

// Cliente del AdminPort del broker (/v1/admin/*). Las mutaciones operativas nunca escriben
// la base directo: el broker mantiene sus invariantes. Ver docs/admin.md (ADM-03).
// Cada llamada lleva un JWT de servicio EdDSA iss=admin, aud=broker, 60 s, sub = id del
// admin y claim email, firmado con ADMIN_SERVICE_PRIVATE_KEY.

export type BrokerAdminClient = AdminPort

export function createBrokerAdminClient({ baseUrl, privateKey, fetch = globalThis.fetch }: {
  baseUrl: string | undefined
  privateKey: JWK | undefined
  // tracedFetch(telemetry) en producción para propagar traceparent.
  fetch?: typeof globalThis.fetch
}): BrokerAdminClient {
  const client = baseUrl && privateKey ? createAdminClient({
    baseUrl, fetch,
    getServiceToken: ({ adminId, email }) => mintServiceToken({ iss: "admin", sub: adminId, email, privateKey }),
  }) : undefined

  async function call(run: (client: AdminPort) => Promise<void>) {
    if (!client) throw new AdminHttpError("upstream", "El broker no está configurado (BROKER_URL y ADMIN_SERVICE_PRIVATE_KEY).")
    try {
      await run(client)
    } catch (error) {
      if (!(error instanceof BrokerError)) throw error
      const options = { errorId: error.errorId }
      if (error.code === "not_found") throw new AdminHttpError("not_found", "El broker no encontró el recurso.", options)
      if (error.code === "invalid_input" || error.code === "conflict" || error.code === "expired") {
        throw new AdminHttpError("invalid_input", `El broker rechazó la acción (${error.code}).`, options)
      }
      throw new AdminHttpError("upstream", "No se pudo completar la acción en el broker.", options)
    }
  }

  return {
    rewake: (...args) => call((port) => port.rewake(...args)),
    expire: (...args) => call((port) => port.expire(...args)),
    revokeAgent: (...args) => call((port) => port.revokeAgent(...args)),
  }
}
