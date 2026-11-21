import type { TelemetryEvent } from "@shared/contract"
import { CopyId } from "@/components/copy-id"
import { Muted } from "@/components/page"

function reference(
  label: string,
  id: string | null,
  route?: string,
  max?: number
) {
  return {
    label,
    value: id ? (
      <CopyId value={id} to={route && `${route}/${id}`} max={max} />
    ) : (
      <Muted />
    ),
  }
}

export function eventReferences(
  event: TelemetryEvent,
  { includeSpan = false } = {}
) {
  return [
    reference("Traza", event.traceId, "/trazas", 16),
    ...(includeSpan ? [reference("Span", event.spanId, undefined, 16)] : []),
    reference("Solicitud", event.requestId, "/solicitudes"),
    reference("Persona", event.userId, "/personas"),
    reference("Agente", event.agentId),
  ]
}
