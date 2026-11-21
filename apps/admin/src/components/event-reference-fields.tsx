import type { TelemetryEvent } from "@shared/contract"
import { CopyId } from "@/components/copy-id"
import { Muted } from "@/components/page"

export function eventReferenceFields({ requestId, userId, agentId }: TelemetryEvent) {
  return [
    { label: "Solicitud", value: requestId ? <CopyId value={requestId} to={`/solicitudes/${requestId}`} /> : <Muted /> },
    { label: "Persona", value: userId ? <CopyId value={userId} to={`/personas/${userId}`} /> : <Muted /> },
    { label: "Agente", value: agentId ? <CopyId value={agentId} /> : <Muted /> },
  ]
}
