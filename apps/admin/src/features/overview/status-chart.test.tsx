// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { formatShortTime } from "@/lib/format"
import { requests } from "@/mocks/fixtures"
import { StatusChart } from "./request-status-panels"

it("expone la hora y los recuentos del intervalo al recorrer el gráfico por teclado", async ({
  onTestFinished,
}) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  // happy-dom carece de layout. El gráfico usa sus dimensiones iniciales.
  vi.stubGlobal("ResizeObserver", undefined)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })
  onTestFinished(async () => {
    await act(() => root.unmount())
    client.clear()
    host.remove()
    vi.unstubAllGlobals()
  })

  const start = new Date("2026-06-01T12:00:00Z").getTime()
  const minute = 60_000
  const items = [
    {
      ...requests[0]!.summary,
      status: "answered",
      createdAt: new Date(start).toISOString(),
    },
    {
      ...requests[1]!.summary,
      status: "denied",
      createdAt: new Date(start + minute).toISOString(),
    },
    {
      ...requests[2]!.summary,
      status: "declined",
      createdAt: new Date(start + minute).toISOString(),
    },
  ]
  client.setQueryData(
    ["overview-requests", "15m"],
    { items, nextCursor: null },
    { updatedAt: start + 15 * minute }
  )

  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <StatusChart window="15m" />
      </QueryClientProvider>
    )
  )
  const chart = host.querySelector<SVGSVGElement>('[role="application"]')!
  await act(() => chart.focus())

  const detail = () => host.querySelector('[role="status"]')?.textContent
  expect(detail()).toContain(formatShortTime(start))
  expect(detail()).toMatch(/Respondidas\s*1(?!\d)/)
  expect(detail()).toMatch(/Rechazadas o denegadas\s*0(?!\d)/)

  await act(() =>
    chart.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
    )
  )
  await vi.waitFor(() =>
    expect(detail()).toContain(formatShortTime(start + minute))
  )
  expect(detail()).toMatch(/Respondidas\s*0(?!\d)/)
  expect(detail()).toMatch(/Rechazadas o denegadas\s*2(?!\d)/)
})
