// @vitest-environment happy-dom
import type { WakeJobRow } from "@shared/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { WakesPage } from "./wakes"

const queued: WakeJobRow = {
  id: "job-1",
  requestId: "req-1",
  attempt: 1,
  state: "queued",
  runAt: "2026-01-02T10:00:00Z",
  kind: "standard_webhook",
  ok: null,
  httpStatus: null,
  code: null,
}
const running: WakeJobRow = {
  ...queued,
  id: "job-2",
  requestId: "req-2",
  state: "running",
}
const delivered: WakeJobRow = {
  ...queued,
  id: "job-3",
  requestId: "req-3",
  state: "done",
  ok: true,
  httpStatus: 204,
}
const failed: WakeJobRow = {
  ...delivered,
  id: "job-4",
  requestId: "req-4",
  ok: false,
  httpStatus: 503,
  code: "retryable",
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let client: QueryClient
let jobs: WakeJobRow[]
const fetchQueue = vi.fn(async (path: string) => {
  const url = new URL(path, window.location.href)
  if (url.pathname !== "/api/admin/wakes")
    return new Response(null, { status: 404 })
  const state = url.searchParams.get("state")
  return Response.json({
    items: state ? jobs.filter((job) => job.state === state) : jobs,
  })
})

beforeEach(() => {
  jobs = [queued, running, delivered, failed]
  fetchQueue.mockClear()
  vi.stubGlobal("fetch", fetchQueue)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(() => root.unmount())
  client.clear()
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openQueue() {
  await act(() =>
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <WakesPage />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  )
  await act(() => vi.advanceTimersByTimeAsync(1))
}

async function selectFilter(label: string) {
  const button = Array.from(
    host.querySelectorAll<HTMLButtonElement>("button")
  ).find((item) => item.textContent === label)
  expect(button).toBeDefined()
  await act(() => button!.click())
  await act(() => vi.advanceTimersByTimeAsync(1))
}

function visibleRows() {
  return Array.from(host.querySelectorAll("tbody tr"), (row) => row.textContent)
}

it("consulta cada estado y cuenta solo los intentos terminados con fallo", async () => {
  await openQueue()
  const all = visibleRows()
  expect(all).toEqual([
    expect.stringContaining("En cola"),
    expect.stringContaining("Ejecutando"),
    expect.stringContaining("Entregado"),
    expect.stringContaining("Fallido"),
  ])
  expect(host.textContent).toContain("4 jobs · 1 fallidos")

  await selectFilter("Terminados")
  expect(visibleRows()).toEqual(all.slice(2))
  expect(host.textContent).toContain("2 jobs · 1 fallidos")

  await selectFilter("Ejecutando")
  expect(visibleRows()).toEqual([all[1]])
  expect(host.textContent).toContain("1 jobs · 0 fallidos")

  await selectFilter("En cola")
  expect(visibleRows()).toEqual([all[0]])

  await selectFilter("Todos")
  expect(visibleRows()).toEqual(all)
  expect(fetchQueue.mock.calls.map(([path]) => path)).toEqual([
    "/api/admin/wakes",
    "/api/admin/wakes?state=done",
    "/api/admin/wakes?state=running",
    "/api/admin/wakes?state=queued",
    "/api/admin/wakes",
  ])
})

it("al refrescar mantiene el filtro y retira un aviso que salió de la cola", async () => {
  await openQueue()
  await selectFilter("En cola")
  expect(visibleRows()).toEqual([expect.stringContaining(queued.requestId)])

  jobs = [{ ...queued, state: "running" }, running, delivered, failed]
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  await act(() => vi.advanceTimersByTimeAsync(1))

  expect(fetchQueue.mock.lastCall?.[0]).toBe("/api/admin/wakes?state=queued")
  expect(visibleRows()).toEqual([expect.stringContaining("Cola vacía")])
  expect(host.textContent).toContain("0 jobs · 0 fallidos")
})
