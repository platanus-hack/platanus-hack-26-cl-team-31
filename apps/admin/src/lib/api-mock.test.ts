import { afterAll, expect, it, vi } from "vitest"
import { subscribeFlow, type FlowStreamHandlers } from "./api"
import { errorEvents } from "@/mocks/fixtures"
import { startMockLive } from "@/mocks/live"

vi.hoisted(() => vi.stubEnv("VITE_ADMIN_MOCK", "1"))
vi.mock("@/mocks/live")
afterAll(() => vi.unstubAllEnvs())

it("cancela el flujo durante la carga y entrega solo eventos del grafo al suscriptor activo", async () => {
  const stop = vi.fn()
  const start = vi.mocked(startMockLive).mockReturnValue(stop)
  const handlers: FlowStreamHandlers = {
    onOpen: vi.fn(), onRow: vi.fn(), onClosed: vi.fn(),
    onRetrying: vi.fn(), onRequest: vi.fn(), onReset: vi.fn(),
  }
  const closeFirst = subscribeFlow(null, handlers)
  closeFirst()
  const closeActive = subscribeFlow(null, handlers)
  await vi.dynamicImportSettled()

  expect(start).toHaveBeenCalledTimes(1)
  const [, live] = start.mock.calls[0]!
  live.onStatus("open")
  expect(handlers.onOpen).toHaveBeenCalledOnce()
  const row = { ...errorEvents[0]!, name: "broker.request.created" }
  live.onEvent({ ...row, name: "http.request" })
  live.onEvent(row)
  expect(handlers.onRow).toHaveBeenCalledExactlyOnceWith(row)
  closeActive()
  expect(stop).toHaveBeenCalledOnce()
})
