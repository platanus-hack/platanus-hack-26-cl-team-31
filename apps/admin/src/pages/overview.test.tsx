// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Overview } from "@shared/contract"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { WindowProvider } from "@/lib/window"
import { requests } from "@/mocks/fixtures"
import { mockApi } from "@/mocks/handlers"
import { OverviewPage } from "./overview"

const now = Date.parse("2026-06-01T12:00:00Z")
const recent = requests.find(({ summary }) => !summary.stuck)!.summary
const stuck = requests.find(({ summary }) => summary.stuck)!.summary
let host: HTMLDivElement
let root: Root
let client: QueryClient

let summary: Overview
beforeAll(async () => {
  summary = Overview.parse(
    await mockApi("overview", { query: { window: "1h" } })
  )
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.spyOn(Date, "now").mockReturnValue(now)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", undefined)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  client.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openOverview(wakes: Overview["wakes"]) {
  const fetchAdmin = vi.fn(async (path: string) => {
    const url = new URL(path, window.location.href)
    if (url.pathname === "/api/admin/overview")
      return Response.json({ ...summary, wakes })
    if (url.pathname !== "/api/admin/requests")
      return new Response(null, { status: 404 })
    return Response.json(
      url.searchParams.get("stuck") === "true"
        ? { items: [stuck], nextCursor: null }
        : { items: [recent], nextCursor: "next-page" }
    )
  })
  vi.stubGlobal("fetch", fetchAdmin)
  await act(() =>
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <WindowProvider>
              <OverviewPage />
            </WindowProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  )
  // El resumen monta el historial y la lista de atascadas al recibir sus datos.
  await act(() => vi.runOnlyPendingTimersAsync())
  await act(() => vi.runOnlyPendingTimersAsync())
  return fetchAdmin
}

const adapters: Overview["wakes"] = [
  { kind: "mcp_events", ok: 12, failed: 1, retried: 3, p95LatencyMs: null },
  {
    kind: "standard_webhook",
    ok: 0,
    failed: 2,
    retried: 2,
    p95LatencyMs: null,
  },
]

it.each([
  {
    case: "varios adaptadores",
    wakes: adapters,
    ratio: "80%",
    counts: "3 fallidos · 5 reintentos",
  },
  {
    case: "solo fallos",
    wakes: [adapters[1]],
    ratio: "0%",
    counts: "2 fallidos · 2 reintentos",
  },
  {
    case: "sin intentos",
    wakes: [],
    ratio: "—",
    counts: "0 fallidos · 0 reintentos",
  },
])(
  "calcula el indicador de avisos entregados con $case",
  async ({ wakes, ratio, counts }) => {
    await openOverview(wakes)
    const card = Array.from(host.querySelectorAll('[data-slot="card"]')).find(
      (element) => element.textContent?.includes("Avisos entregados")
    )!
    expect(card.querySelector('[data-slot="card-title"]')?.textContent).toBe(
      ratio
    )
    expect(card.textContent).toContain(counts)
  }
)

it("consulta las atascadas por separado de la muestra de la última hora", async () => {
  const fetchAdmin = await openOverview([])
  expect(
    host.querySelector(`a[href="/solicitudes/${stuck.id}"]`)
  ).not.toBeNull()
  expect(host.querySelector(`a[href="/solicitudes/${recent.id}"]`)).toBeNull()
  expect(host.textContent).toContain("muestra de las 200 más recientes")
  const filters = fetchAdmin.mock.calls
    .map(([path]) => new URL(path, window.location.href))
    .filter(({ pathname }) => pathname === "/api/admin/requests")
    .map(({ searchParams }) => Object.fromEntries(searchParams))
  expect(filters).toEqual(
    expect.arrayContaining([
      { limit: "8", stuck: "true" },
      { limit: "200", since: "2026-06-01T11:00:00.000Z" },
    ])
  )
})
