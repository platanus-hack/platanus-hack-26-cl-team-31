// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AgentRow } from "@shared/contract"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { DataTable } from "@/components/data-table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { agentColumns, agentHealth } from "./agent-columns"

const active: AgentRow = {
  agentId: "actual",
  userId: "ana",
  label: "Agente actual",
  wakeKind: "standard_webhook",
  wakeHost: "avisos.example",
  createdAt: "2026-05-12T00:00:00Z",
  lastWakeAt: null,
  verifiedAt: null,
  revokedAt: null,
  wakes24h: { ok: 4, failed: 6 },
}
const revoked: AgentRow = {
  ...active,
  agentId: "anterior",
  label: "Agente anterior",
  revokedAt: "2026-05-13T00:00:00Z",
}

describe("salud del agente", () => {
  it.each([
    { ok: 0, failed: 0, tone: "neutral", label: "Sin tráfico" },
    { ok: 90, failed: 10, tone: "ok", label: "Sano" },
    { ok: 89, failed: 11, tone: "warn", label: "Inestable" },
    { ok: 50, failed: 50, tone: "warn", label: "Inestable" },
    { ok: 49, failed: 51, tone: "error", label: "Fallando" },
  ])(
    "con $ok entregados y $failed fallidos indica $label",
    ({ ok, failed, ...health }) => {
      expect(agentHealth({ ...active, wakes24h: { ok, failed } })).toEqual(
        health
      )
    }
  )

  it("prioriza la revocación y la falta de adaptador sobre el historial de avisos", () => {
    expect(agentHealth({ ...revoked, wakeKind: "none" })).toEqual({
      tone: "neutral",
      label: "Revocado",
    })
    expect(agentHealth({ ...active, wakeKind: "none" })).toEqual({
      tone: "neutral",
      label: "Sin aviso",
    })
  })
})

describe("tabla de agentes", () => {
  async function renderTable(options: Parameters<typeof agentColumns>[0]) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const client = new QueryClient()
    const host = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host)
    // Radix abre el menú fuera de la tabla. Desmontarlo también limpia ese portal.
    onTestFinished(async () => {
      await act(() => root.unmount())
      client.clear()
      host.remove()
      vi.unstubAllGlobals()
    })
    await act(() =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <TooltipProvider>
              <DataTable
                columns={agentColumns(options)}
                data={[revoked, active]}
              />
            </TooltipProvider>
          </QueryClientProvider>
        </MemoryRouter>
      )
    )
    return host
  }

  it("en la lista de lectura enlaza al titular y muestra la salud y las entregas de cada fila", async () => {
    const table = await renderTable({})
    const [previous, current] = table.querySelectorAll("tbody tr")
    expect(previous.textContent).toContain("Revocado")
    expect(current.textContent).toContain("Fallando")
    expect(current.textContent).toContain("4/10")
    expect(current.querySelector("a")?.getAttribute("href")).toBe(
      "/personas/ana"
    )
    expect(table.querySelector('button[aria-label="Acciones"]')).toBeNull()
  })

  async function revokeFrom(row: Element) {
    const trigger = row.querySelector<HTMLButtonElement>(
      'button[aria-label="Acciones"]'
    )!
    await act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    })
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(item.textContent).toBe("Revocar agente")
    await act(() => item.click())
  }

  it("en el detalle de persona permite revocar el agente seleccionado", async () => {
    const onRevoke = vi.fn()
    const table = await renderTable({ showUser: false, onRevoke })
    expect(table.querySelector("tbody a")).toBeNull()
    const [, current] = table.querySelectorAll("tbody tr")
    await revokeFrom(current)
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(active)
  })

  it("impide volver a revocar un agente desde su fila", async () => {
    const onRevoke = vi.fn()
    const table = await renderTable({ showUser: false, onRevoke })
    const [previous] = table.querySelectorAll("tbody tr")
    await revokeFrom(previous)
    expect(onRevoke).not.toHaveBeenCalled()
  })
})
