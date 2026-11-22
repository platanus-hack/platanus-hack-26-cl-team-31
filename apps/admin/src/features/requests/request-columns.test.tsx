// @vitest-environment happy-dom
import type { RequestSummary } from "@shared/contract"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { expect, it, onTestFinished, vi } from "vitest"

import { DataTable } from "@/components/data-table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { requests } from "@/mocks/fixtures"
import { requestColumns } from "./request-columns"

async function renderRequests(data: RequestSummary[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  onTestFinished(async () => {
    await act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })
  await act(() =>
    root.render(
      <MemoryRouter>
        <TooltipProvider>
          <DataTable columns={requestColumns} data={data} />
        </TooltipProvider>
      </MemoryRouter>
    )
  )
  return host.querySelector("table")!
}

it("distingue la falta de intentos del resultado del último aviso de cada solicitud", async () => {
  const cases = [
    { wakeAttempts: 0, lastWakeOk: null, expected: "Sin intentos" },
    { wakeAttempts: 2, lastWakeOk: true, expected: "2 · Último entregado" },
    { wakeAttempts: 2, lastWakeOk: false, expected: "2 · Último fallido" },
    { wakeAttempts: 2, lastWakeOk: null, expected: "2 · Sin resultado" },
  ]
  const table = await renderRequests(
    cases.map(({ wakeAttempts, lastWakeOk }, index) => ({
      ...requests[index]!.summary,
      wakeAttempts,
      lastWakeOk,
    }))
  )
  const column = Array.from(table.querySelectorAll("th")).findIndex(
    (header) => header.textContent === "Avisos"
  )
  const cells = Array.from(table.querySelectorAll("tbody tr"), (row) =>
    row.querySelectorAll("td")[column]?.textContent
  )
  expect(cells).toEqual(cases.map(({ expected }) => expected))
})

it("marca solo la solicitud que el broker informa como atascada", async () => {
  const pending = requests[0]!.summary
  const table = await renderRequests([
    { ...pending, id: "en-plazo", status: "awaiting_agent", stuck: false },
    { ...pending, id: "fuera-de-plazo", status: "awaiting_agent", stuck: true },
  ])
  const alerts = table.querySelectorAll('[aria-label="Atascada"]')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]!.closest("tr")?.querySelector("a")?.getAttribute("href")).toBe(
    "/solicitudes/fuera-de-plazo"
  )
})
