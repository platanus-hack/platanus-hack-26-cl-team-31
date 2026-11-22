// @vitest-environment happy-dom
import type { UserDetail } from "@shared/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { agentRows, requests, userSummaries } from "@/mocks/fixtures"
import { UserDetailPage } from "./user-detail"

let isOperator: boolean
vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator }) }))

const summary = userSummaries().find((person) => person.userId === "usr_simon")!
const agents = agentRows().filter((agent) => agent.userId === summary.userId)
const recentRequest = { ...requests[0]!.summary, id: "req/turno?2#fin" }
const detail: UserDetail = {
  summary,
  identity: { email: null, activeSessions: 0, oauthClients: [] },
  agents,
  recentRequests: [recentRequest],
  rules: { circles: { trabajo: ["ana@sideband.app"] } },
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

beforeEach(() => {
  isOperator = false
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  router = createMemoryRouter(
    [
      { path: "/personas/:id", Component: UserDetailPage },
      { path: "/solicitudes/:id", element: <h1>Solicitud</h1> },
    ],
    { initialEntries: [`/personas/${summary.userId}`] }
  )
})

afterEach(async () => {
  await act(() => root.unmount())
  router.dispose()
  client.clear()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function openPerson() {
  vi.stubGlobal("fetch", async (path: string) =>
    path === `/api/admin/users/${summary.userId}`
      ? Response.json(detail)
      : new Response(null, { status: 404 })
  )
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
  expect(host.querySelector("h1")?.textContent).toContain(summary.displayName)
}

it("permite al viewer copiar las reglas históricas y consultar los agentes", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  await openPerson()
  expect(host.textContent).toContain(agents[0]!.agentId)
  expect(host.querySelector('button[aria-label="Acciones"]')).toBeNull()
  const shown = host.querySelector("pre")!.textContent
  expect(JSON.parse(shown)).toEqual(detail.rules)
  const copy = host.querySelector<HTMLButtonElement>(
    '[aria-label="Copiar reglas"]'
  )!
  await act(() => copy.click())
  expect(write).toHaveBeenCalledExactlyOnceWith(shown)
})

it("abre la revocación del agente elegido por el operador", async () => {
  isOperator = true
  await openPerson()
  const selected = agents[1]!
  const row = Array.from(host.querySelectorAll("tbody tr")).find((item) =>
    item.textContent.includes(selected.agentId)
  )!
  const actions = row.querySelector<HTMLButtonElement>(
    '[aria-label="Acciones"]'
  )!
  await act(() => {
    actions.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  })
  const revoke = document.querySelector<HTMLElement>('[role="menuitem"]')!
  await act(() => revoke.click())
  const dialog = document.querySelector('[role="alertdialog"]')
  expect(dialog?.textContent).toContain(selected.label)
  expect(dialog?.textContent).toContain(selected.userId)
})

it.each(["la fila", "el enlace"] as const)(
  "abre el id completo de una solicitud reciente desde %s",
  async (entry) => {
    await openPerson()
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href^="/solicitudes/"]'
    )!
    const target = entry === "la fila" ? link.closest("tr")! : link
    await act(() => target.click())
    expect(router.state.location.pathname).toBe(
      "/solicitudes/req%2Fturno%3F2%23fin"
    )
    expect(router.state.matches.at(-1)?.params.id).toBe(recentRequest.id)
  }
)
