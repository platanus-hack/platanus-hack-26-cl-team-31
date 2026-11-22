import { expect, it } from "vitest"
import type { TelemetryEvent } from "../../shared/contract.js"
import { eventsText } from "./format.js"

it("indica el menor ID exacto para retroceder en el historial de admin_events", () => {
  const ids = ["10000000000000000", "9999999999999999", "10000000000000001"]
  const events = ids.map((id): TelemetryEvent => ({
    id,
    at: "2026-01-01T00:00:00Z",
    service: "broker",
    kind: "lifecycle",
    name: "service.heartbeat",
    level: "info",
    traceId: null,
    spanId: null,
    parentSpanId: null,
    requestId: null,
    userId: null,
    agentId: null,
    durationMs: null,
    status: null,
    errorId: null,
    attrs: {},
  }))

  expect(eventsText(events)).toContain('before_id="9999999999999999"')
})
