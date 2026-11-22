// @vitest-environment happy-dom
import type { Trace } from "@shared/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { traceQuery } from "@/lib/queries"
import { buildFeaturedTrace, FEATURED_ERROR_ID } from "@/mocks/fixtures"
import { TraceDetailPage } from "@/pages/traces"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let client: QueryClient

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient()
})

afterEach(async () => {
  await act(() => root.unmount())
  client.clear()
  host.remove()
  vi.unstubAllGlobals()
})

async function openTrace(trace: Trace) {
  client.setQueryData(traceQuery(trace.traceId).queryKey, trace)
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/trazas/${trace.traceId}`]}>
            <Routes>
              <Route path="/trazas/:id" element={<TraceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
}

function rowsNamed(name: string) {
  return Array.from(host.querySelectorAll("button")).filter((button) =>
    button.textContent.includes(name)
  )
}

it("abre el detalle del intento elegido cuando dos spans tienen el mismo nombre", async () => {
  await openTrace(buildFeaturedTrace())
  const attempts = rowsNamed("http.request POST /v1/agent/reply")
  expect(attempts).toHaveLength(2)
  const errorLink = () =>
    host.querySelector(`a[href="/errores/${FEATURED_ERROR_ID}"]`)
  expect(errorLink()).toBeNull()

  await act(() => attempts[0]!.click())
  expect(errorLink()).not.toBeNull()
  expect(host.textContent).toContain("status=422")
  await act(() => attempts[1]!.click())
  expect(errorLink()).toBeNull()
  expect(host.textContent).toContain("status=200")
  expect(host.textContent).not.toContain("status=422")
})

it("alinea las barras en una escala común y conserva visible el evento final sin duración", async () => {
  const trace = buildFeaturedTrace()
  const first = trace.spans[0]!
  const start = Date.parse(first.startAt)
  const child = { ...first, parentSpanId: first.spanId }
  await openTrace({
    ...trace,
    spans: [
      { ...first, durationMs: 100 },
      {
        ...child,
        spanId: "middle",
        name: "intermedio",
        startAt: new Date(start + 50).toISOString(),
        durationMs: 20,
      },
      {
        ...child,
        spanId: "end",
        name: "final",
        startAt: new Date(start + 100).toISOString(),
        durationMs: null,
      },
    ],
  })

  function bar(name: string) {
    return rowsNamed(name)[0]!.querySelector<HTMLElement>(
      '[data-slot="tooltip-trigger"]'
    )!
  }
  expect(bar("intermedio").style.left).toBe("50%")
  expect(bar("intermedio").style.width).toBe("20%")
  const last = bar("final")
  const width = parseFloat(last.style.width)
  expect(width).toBeGreaterThan(0)
  expect(parseFloat(last.style.left) + width).toBeCloseTo(100)
})
