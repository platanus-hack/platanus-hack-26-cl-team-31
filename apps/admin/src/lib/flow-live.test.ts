// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { FlowSnapshot, TelemetryEvent } from "@shared/contract"
import { api, subscribeFlow } from "./api"
import { useFlowLive } from "./flow-live"

vi.mock("./api", () => ({ api: vi.fn(), subscribeFlow: vi.fn(), isApiError: () => false }))

const snapshot: FlowSnapshot = {
  generatedAt: new Date(0).toISOString(), cursor: "1", users: [], requests: [], agents: [], truncated: false,
}

let root: ReturnType<typeof createRoot>

function Stream() {
  useFlowLive()
  return null
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  vi.mocked(api).mockResolvedValue(snapshot)
  vi.mocked(subscribeFlow).mockReturnValue(() => {})
  root = createRoot(document.createElement("div"))
  await act(() => root.render(createElement(Stream)))
})

afterEach(async () => {
  await act(() => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

function observeConnection() {
  const handlers = vi.mocked(subscribeFlow).mock.calls[0][1]
  const row: TelemetryEvent = {
    id: "2", at: new Date().toISOString(), service: "broker", kind: "lifecycle", name: "broker.agent.connected", level: "info",
    traceId: null, spanId: null, parentSpanId: null, requestId: null, userId: "new-owner", agentId: "new-agent",
    durationMs: null, status: null, errorId: null, attrs: {},
  }
  act(() => handlers.onRow(row))
  return handlers
}

it("refreshes an unknown identity after the throttle expires without a second event", async () => {
  observeConnection()
  await advance(4_800)
  expect(api).toHaveBeenCalledTimes(1)
  await advance(600)
  expect(api).toHaveBeenCalledTimes(2)
})

it("resumes a short outage from the last event after an earlier native reconnect", async () => {
  const stream = observeConnection()
  act(() => stream.onRetrying())
  await advance(1_000)
  act(() => stream.onOpen())
  await advance(62_000)
  vi.mocked(api).mockResolvedValue({ ...snapshot, cursor: "9" })
  act(() => stream.onClosed())
  await advance(1_000)
  expect(subscribeFlow).toHaveBeenLastCalledWith("2", expect.any(Object))
})
