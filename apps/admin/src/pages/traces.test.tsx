// @vitest-environment happy-dom
import type { TelemetryEvent } from "@shared/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { buildFeaturedTrace, errorEvents, TRACE_ID } from "@/mocks/fixtures"
import { TraceDetailPage, TracesPage } from "./traces"

const requestId = "req/turno?2#fin"
const requestPath = "/solicitudes/req%2Fturno%3F2%23fin"
const first: TelemetryEvent = {
  ...errorEvents[0]!,
  traceId: TRACE_ID,
  at: "2026-01-02T10:00:00Z",
  requestId,
}
const last: TelemetryEvent = {
  ...first,
  id: "2",
  at: "2026-01-02T10:01:00Z",
  name: "http.request",
  requestId: null,
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  router = createMemoryRouter(
    [
      { path: "/trazas", Component: TracesPage },
      { path: "/trazas/:id", Component: TraceDetailPage },
      { path: "/solicitudes/:id", element: <h1>Solicitud</h1> },
    ],
    { initialEntries: ["/trazas"] }
  )
})

afterEach(async () => {
  await act(() => root.unmount())
  router.dispose()
  client.clear()
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openList(items: TelemetryEvent[]) {
  const trace = buildFeaturedTrace()
  vi.stubGlobal("fetch", async (path: string) => {
    if (path === "/api/admin/events?limit=300")
      return Response.json({ items, nextCursor: null })
    if (path === `/api/admin/traces/${TRACE_ID}`)
      return Response.json({
        ...trace,
        spans: [{ ...trace.spans[0]!, requestId }],
      })
    return new Response(null, { status: 404 })
  })
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
  await act(() => vi.advanceTimersByTimeAsync(1))
}

it("abre la solicitud de un evento anterior desde la fila de su traza", async () => {
  await openList([last, first])
  const rows = host.querySelectorAll("tbody tr")
  expect(rows).toHaveLength(1)
  const link = rows[0]!.querySelector<HTMLAnchorElement>(
    'a[href^="/solicitudes/"]'
  )
  expect(link?.getAttribute("href")).toBe(requestPath)
  await act(() => link!.click())
  expect(router.state.location.pathname).toBe(requestPath)
})

it("abre la cascada desde la fila y conserva la solicitud del span en el detalle", async () => {
  await openList([first])
  const row = host.querySelector<HTMLTableRowElement>("tbody tr")!
  await act(() => row.click())
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(host.querySelector("h1")?.textContent).toContain(TRACE_ID)
  const action = Array.from(host.querySelectorAll("a")).find(
    (link) => link.textContent === "Ver solicitud"
  )
  expect(action?.getAttribute("href")).toBe(requestPath)
})

it("ignora una búsqueda en blanco y abre por id una traza fuera del listado", async () => {
  await openList([])
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Trace id"]'
  )!
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!
  async function type(value: string) {
    await act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  await type("   ")
  expect(submit.disabled).toBe(true)
  await act(() => input.form!.requestSubmit())
  expect(router.state.location.pathname).toBe("/trazas")

  await type(`  ${TRACE_ID}  `)
  await act(() => submit.click())
  expect(router.state.location.pathname).toBe(`/trazas/${TRACE_ID}`)
})
