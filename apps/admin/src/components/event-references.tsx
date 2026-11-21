import type { TelemetryEvent } from "@shared/contract"
import { CopyId } from "@/components/copy-id"
import { Muted } from "@/components/page"
import { buildPath } from "@/lib/api"

function reference(
  label: string,
  id: string | null,
  route?: string,
  max?: number
) {
  return {
    label,
    value: id ? (
      <CopyId value={id} to={route && buildPath(route, { id })} max={max} />
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
    reference("Traza", event.traceId, "/trazas/:id", 16),
    ...(includeSpan ? [reference("Span", event.spanId, undefined, 16)] : []),
    reference("Solicitud", event.requestId, "/solicitudes/:id"),
    reference("Persona", event.userId, "/personas/:id"),
    reference("Agente", event.agentId),
  ]
}
