// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { agentRows } from "@/mocks/fixtures"
import { AgentsPage } from "./agents"

vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator: false }) }))

it("muestra solo los agentes con avisos fallando y recupera la lista al quitar el filtro", async ({
  onTestFinished,
}) => {
  const agents = agentRows()
  const healthy = agents.find(({ wakes24h }) => wakes24h.ok > wakes24h.failed)!
  const failing = agents.find(({ wakes24h }) => wakes24h.failed > wakes24h.ok)!
  const fetchAgents = vi.fn(async (path: string) => {
    if (path === "/api/admin/agents")
      return Response.json({ items: [healthy, failing] })
    if (path === "/api/admin/agents?failing=true")
      return Response.json({ items: [failing] })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal("fetch", fetchAgents)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  onTestFinished(async () => {
    await act(() => root.unmount())
    client.clear()
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  await act(() =>
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <AgentsPage />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  )
  async function visibleAgents() {
    await act(() => vi.runOnlyPendingTimersAsync())
    return host.querySelector("tbody")?.textContent
  }
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!
  const initial = await visibleAgents()
  expect(initial).toContain(healthy.agentId)
  expect(initial).toContain(failing.agentId)

  await act(() => toggle.click())
  const filtered = await visibleAgents()
  expect(fetchAgents.mock.lastCall?.[0]).toBe("/api/admin/agents?failing=true")
  expect(filtered).toContain(failing.agentId)
  expect(filtered).not.toContain(healthy.agentId)

  await act(() => toggle.click())
  const restored = await visibleAgents()
  expect(restored).toContain(healthy.agentId)
  expect(restored).toContain(failing.agentId)
})
