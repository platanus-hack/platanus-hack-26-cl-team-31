import type { PayloadReveal } from "../shared/contract.js"

// Lectura del payload real de una solicitud (ops.v_request_payloads con SET LOCAL ROLE
// nexo_admin_reveal). La implementa ADM-02 en server/queries/reveal.ts (createPgRevealer).
// El servidor audita antes de llamar y nunca guarda ni registra lo que devuelve.
export type RevealedPayload = Pick<PayloadReveal, "args" | "purpose" | "result"> & { requestId?: string }

export interface Revealer {
  // null si la solicitud no existe.
  reveal(requestId: string): Promise<RevealedPayload | null>
}
