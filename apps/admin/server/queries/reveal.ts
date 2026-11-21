// Lectura del payload real de una solicitud (args, purpose, result). Es la ÚNICA lectura que
// usa nexo_admin_reveal, el único rol con SELECT en ops.v_request_payloads.
//
// La usa el servidor admin (ADM-04) en POST /api/admin/requests/:id/reveal, después de verificar
// rol operator, sesión fresca, Origin y motivo, y de escribir la auditoría. Este módulo no
// audita ni guarda nada: nunca lo expongas en el MCP ni en otra ruta.
import { createPool, readOnly } from "./db.js"

export type RevealedPayload = {
  args: unknown
  purpose: string | null
  result: unknown | null
}

export interface PgRevealer {
  // null si la solicitud no existe.
  reveal(requestId: string): Promise<RevealedPayload | null>
  close(): Promise<void>
}

export function createPgRevealer({
  databaseUrl,
}: {
  databaseUrl: string
}): PgRevealer {
  const pool = createPool(databaseUrl)
  return {
    reveal: (requestId) =>
      readOnly(pool, "nexo_admin_reveal", async (db) => {
        const { rows } = await db.query<RevealedPayload>(
          "SELECT args, purpose, result FROM ops.v_request_payloads WHERE id = $1",
          [requestId]
        )
        const row = rows[0]
        return row
          ? {
              args: row.args,
              purpose: row.purpose ?? null,
              result: row.result ?? null,
            }
          : null
      }),
    close: () => pool.end(),
  }
}
