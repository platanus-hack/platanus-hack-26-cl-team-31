import { TelemetryEvent } from "@shared/contract"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import type { LiveFilters } from "@/lib/api"
import * as fixtures from "./fixtures"
import { startMockLive } from "./live"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it("abre con los últimos 50 eventos que cumplen todos los filtros, del más antiguo al más reciente", () => {
  const filters = {
    service: "broker",
    kind: "policy",
    level: "info",
    name: "broker.policy.evaluated",
    requestId: "req-1",
    traceId: "trace-1",
    userId: "user-1",
  } satisfies LiveFilters
  const row = { ...fixtures.errorEvents[0]!, ...filters }
  const history = Array.from({ length: 55 }, (_, index) => ({
    ...row,
    id: String(55 - index),
  }))
  vi.spyOn(fixtures, "historyEvents").mockReturnValue([
    { ...row, service: "mcp" },
    { ...row, kind: "http" },
    { ...row, level: "warn" },
    { ...row, name: filters.name + ".extra" },
    { ...row, requestId: null },
    { ...row, traceId: null },
    { ...row, userId: null },
    ...history,
  ])
  const received: string[] = []
  const close = startMockLive(filters, {
    onStatus: (status) => received.push(status),
    onEvent: (event) => received.push(event.id),
  })
  vi.advanceTimersToNextTimer()
  expect(received).toEqual([
    "open",
    ...Array.from({ length: 50 }, (_, i) => String(i + 6)),
  ])
  close()
})

it("sigue filtrando eventos nuevos y deja de entregarlos al cerrar", () => {
  vi.spyOn(fixtures, "historyEvents").mockReturnValue([])
  const random = vi.spyOn(Math, "random").mockReturnValue(0)
  const events: TelemetryEvent[] = []
  const close = startMockLive(
    { name: "http.request" },
    {
      onStatus: vi.fn(),
      onEvent: (event) => events.push(TelemetryEvent.parse(event)),
    }
  )
  vi.advanceTimersToNextTimer() // Apertura sin historial.
  vi.advanceTimersToNextTimer() // Ráfaga de peticiones HTTP.
  const count = events.length
  expect(count).toBeGreaterThan(1)
  expect(new Set(events.map((event) => event.id)).size).toBe(count)
  expect(events.every((event) => event.name === "http.request")).toBe(true)

  random.mockReturnValue(0.99) // El siguiente evento pertenece a otro servicio y nombre.
  vi.advanceTimersToNextTimer()
  expect(events).toHaveLength(count)
  random.mockReturnValue(0)
  vi.advanceTimersToNextTimer()
  expect(events.length).toBeGreaterThan(count)

  close()
  const atClose = events.length
  vi.advanceTimersByTime(60_000)
  expect(events).toHaveLength(atClose)
})

it("cancelar antes de la apertura impide tanto el historial como los eventos nuevos", () => {
  const handlers = { onStatus: vi.fn(), onEvent: vi.fn() }
  const close = startMockLive({}, handlers)
  close()
  vi.advanceTimersByTime(60_000)
  expect(handlers.onStatus).not.toHaveBeenCalled()
  expect(handlers.onEvent).not.toHaveBeenCalled()
})
