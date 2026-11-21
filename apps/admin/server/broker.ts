import { randomUUID } from "node:crypto"
import { importJWK, SignJWT, type JWK } from "jose"
import { AdminHttpError } from "./errors.js"

// Cliente del AdminPort del broker (/v1/admin/*). Las mutaciones operativas nunca escriben
// la base directo: el broker mantiene sus invariantes. Ver docs/admin.md (ADM-03).
//
// Firma un JWT de servicio EdDSA con iss=admin, aud=broker, 60 s, sub = id del admin y el
// claim email. Lo minteamos aquí con jose para no depender de @team-31/auth mientras ADM-03
// agrega el issuer "admin" a packages/auth/src/service.ts.

export type AdminActor = { adminId: string; email: string }

export interface BrokerAdminClient {
  rewake(actor: AdminActor, requestId: string, reason: string): Promise<void>
  expire(actor: AdminActor, requestId: string, reason: string): Promise<void>
  revokeAgent(actor: AdminActor, userId: string, agentId: string, reason: string): Promise<void>
}

const ALGORITHM = "EdDSA"
const TTL_SECONDS = 60
const TIMEOUT_MS = 10_000

export async function mintAdminServiceToken(actor: AdminActor, privateKey: JWK): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: actor.email })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer("admin")
    .setAudience("broker")
    .setSubject(actor.adminId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TTL_SECONDS)
    .setJti(randomUUID())
    .sign(await importJWK(privateKey, ALGORITHM))
}

export function createBrokerAdminClient({ baseUrl, privateKey, fetch = globalThis.fetch }: {
  baseUrl: string | undefined
  privateKey: JWK | undefined
  fetch?: typeof globalThis.fetch
}): BrokerAdminClient {
  async function call(actor: AdminActor, path: string, reason: string) {
    if (!baseUrl || !privateKey) {
      throw new AdminHttpError("upstream", "El broker no está configurado (BROKER_URL y ADMIN_SERVICE_PRIVATE_KEY).")
    }
    const token = await mintAdminServiceToken(actor, privateKey)
    let response: Response
    try {
      // TODO(admin): usar tracedFetch(telemetry) para propagar traceparent (ADM-01).
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
    if (response.status === 400 || response.status === 409 || response.status === 410) {
      throw new AdminHttpError("invalid_input", `El broker rechazó la acción${typeof code === "string" ? ` (${code})` : ""}.`)
    }
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
