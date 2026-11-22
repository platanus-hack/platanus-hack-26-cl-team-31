// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { FlowSnapshot, TelemetryEvent } from "@shared/contract"
import { api, subscribeFlow } from "./api"
import { useFlowLive } from "./flow-live"

vi.mock(import("./api"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(), subscribeFlow: vi.fn(actual.subscribeFlow) }
})

class EventSourceStub extends EventTarget {
  static current: EventSourceStub
  close = vi.fn()

  constructor() {
    super()
    EventSourceStub.current = this
  }
}

const snapshot: FlowSnapshot = {
  generatedAt: new Date(0).toISOString(), cursor: "1", users: [], requests: [], agents: [], truncated: false,
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function Stream() {
  const { truncated } = useFlowLive()
  return truncated ? "truncated" : "complete"
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  vi.mocked(api).mockResolvedValue(snapshot)
  vi.stubGlobal("EventSource", EventSourceStub)
  container = document.createElement("div")
  root = createRoot(container)
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

it("resumes from the initial snapshot if disconnected before the first row", async () => {
  const stream = vi.mocked(subscribeFlow).mock.calls[0][1]
  vi.mocked(api).mockResolvedValue({ ...snapshot, cursor: "9" })
  act(() => stream.onClosed())
  await advance(1_000)
  expect(subscribeFlow).toHaveBeenLastCalledWith("1", expect.any(Object))
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

it("resumes a long outage from the new snapshot cursor", async () => {
  const stream = observeConnection()
  act(() => stream.onRetrying())
  await advance(60_000)
  vi.mocked(api).mockResolvedValue({ ...snapshot, cursor: "9" })
  act(() => stream.onClosed())
  await advance(1_000)
  expect(subscribeFlow).toHaveBeenLastCalledWith("9", expect.any(Object))
})

it.each(["{", "{}"])("recovers from a reset with malformed data %j using a fresh snapshot", async (data) => {
  const stream = EventSourceStub.current
  vi.mocked(api).mockResolvedValue({ ...snapshot, cursor: "9", truncated: true })
  await act(() => {
    stream.dispatchEvent(new MessageEvent("reset", { data, lastEventId: "8" }))
  })
  expect(stream.close).toHaveBeenCalledOnce()
  expect(api).toHaveBeenCalledTimes(2)
  expect(container.textContent).toBe("truncated")
  expect(subscribeFlow).toHaveBeenLastCalledWith("9", expect.any(Object))
})

it("keeps the reset snapshot when an earlier directory refresh finishes late", async () => {
  const stream = observeConnection()
  vi.mocked(api).mockImplementationOnce(
    () => new Promise<FlowSnapshot>((resolve) => setTimeout(() => resolve(snapshot), 1_000))
  )
  await advance(5_200)
  expect(api).toHaveBeenCalledTimes(2)

  vi.mocked(api).mockResolvedValue({ ...snapshot, cursor: "9", truncated: true })
  await act(() => stream.onReset("8"))
  expect(subscribeFlow).toHaveBeenLastCalledWith("9", expect.any(Object))

  await advance(1_000)
  expect(container.textContent).toBe("truncated")
})
