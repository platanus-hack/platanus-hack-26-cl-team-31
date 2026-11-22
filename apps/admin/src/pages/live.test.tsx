// @vitest-environment happy-dom
import type { TelemetryEvent } from "@shared/contract"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { subscribeLive } from "@/lib/api"
import { errorEvents } from "@/mocks/fixtures"
import { LivePage } from "./live"

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  subscribeLive: vi.fn(),
}))

const subscription = vi.mocked(subscribeLive)
let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  subscription.mockImplementation(() => vi.fn())
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  await act(() => root.render(<LivePage />))
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  subscription.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function event(id: number, name = `evento-${id}`): TelemetryEvent {
  return {
    ...errorEvents[0]!,
    id: String(id),
    name,
    at: new Date().toISOString(),
    attrs: {},
  }
}

function receive(...events: TelemetryEvent[]) {
  const [, stream] = subscription.mock.lastCall!
  act(() => events.forEach(stream.onEvent))
}

function advance(ms = 100) {
  return act(() => vi.advanceTimersByTimeAsync(ms))
}

function names() {
  return Array.from(
    host.querySelectorAll("tbody td:nth-child(3)"),
    (cell) => cell.textContent
  )
}

function button(label: string) {
  const match = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === label
  )
  expect(match, label).toBeDefined()
  return match!
}

it("muestra el estado de la conexión y cuenta solo eventos del último minuto", async () => {
  const [, stream] = subscription.mock.lastCall!
  expect(host.textContent).toContain("Conectando…")
  act(() => stream.onStatus("open"))
  expect(host.textContent).toContain("Esperando eventos…")
  receive(
    { ...event(1), at: new Date(Date.now() - 59_000).toISOString() },
    event(2)
  )
  await advance()
  expect(names()).toEqual(["evento-2", "evento-1"])
  expect(host.textContent).toContain("2/min")
  await advance(5_000)
  expect(host.textContent).toContain("1/min")
  act(() => stream.onStatus("error"))
  expect(host.textContent).toContain("Desconectado")
  expect(names()).toEqual(["evento-2", "evento-1"])
})

it("al pausar y reanudar incorpora los lotes pendientes y conserva la última copia de cada id", async () => {
  receive(event(1), event(2), event(1, "repetido"))
  expect(names()).toEqual([])
  act(() => button("Pausar").click())
  expect(names()).toEqual(["repetido", "evento-2"])

  receive(event(3), event(1, "actualizado"))
  await advance()
  expect(names()).toEqual(["repetido", "evento-2"])
  receive(event(4))
  act(() => button("Reanudar+2").click())
  expect(names()).toEqual(["evento-4", "actualizado", "evento-3", "evento-2"])
  await advance()
  expect(subscription).toHaveBeenCalledTimes(1)
})

it("limpia filas visibles, acumuladas y pendientes sin salir de pausa", async () => {
  receive(event(1))
  act(() => button("Pausar").click())
  receive(event(2))
  await advance()
  receive(event(3))
  act(() => button("Limpiar").click())
  await advance()
  expect(names()).toEqual([])
  act(() => button("Reanudar").click())
  expect(names()).toEqual([])
  receive(event(4))
  await advance()
  expect(names()).toEqual(["evento-4"])
})

it("conserva los 500 eventos más recientes tras una ráfaga en pausa", async () => {
  receive(event(0))
  act(() => button("Pausar").click())
  receive(...Array.from({ length: 501 }, (_, i) => event(i + 1)))
  await advance()
  receive(event(502))
  await advance()
  expect(names()).toEqual(["evento-0"])
  act(() => button("Reanudar+500").click())
  expect(names()).toEqual(
    Array.from({ length: 500 }, (_, i) => `evento-${502 - i}`)
  )
})

it("al filtrar cierra la suscripción anterior y empieza con la cola vacía", async () => {
  const close = subscription.mock.results[0]!.value
  receive(event(1))
  act(() => button("Pausar").click())
  receive(event(2))
  await advance()
  receive(event(3))
  act(() => button("error").click())
  expect(close).toHaveBeenCalledOnce()
  expect(subscription).toHaveBeenLastCalledWith(
    expect.objectContaining({ level: "error" }),
    expect.any(Object)
  )
  await advance()
  expect(names()).toEqual([])
  expect(button("Pausar").disabled).toBe(false)
  receive(event(4))
  await advance()
  expect(names()).toEqual(["evento-4"])
})
