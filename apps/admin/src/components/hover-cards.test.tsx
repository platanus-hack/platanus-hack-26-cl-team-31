// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { agentRows, requests, userSummaries } from "@/mocks/fixtures"
import { PersonHoverCard, RequestHoverCard } from "./hover-cards"

let host: HTMLDivElement
let root: Root
let client: QueryClient
const fetchDetail = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchDetail.mockReset())
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

async function hoverCard(Card: typeof PersonHoverCard, id: string) {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <Card id={id}>
              <span>{id}</span>
            </Card>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  )
  expect(fetchDetail).not.toHaveBeenCalled()
  const trigger = host.firstElementChild!
  await act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })
    )
  })
  await act(() => vi.advanceTimersByTimeAsync(1000))
  // Entrega la notificación de React Query después de montar el contenido.
  await act(() => vi.advanceTimersByTimeAsync(1))
}

it("consulta la persona al abrir, cuenta solo agentes activos y enlaza su ID completo", async () => {
  const carla = userSummaries().find((user) => user.userId === "usr_carla")!
  const id = "usr/carla?b#c"
  fetchDetail.mockResolvedValue(
    Response.json({
      summary: { ...carla, userId: id },
      identity: { email: null, activeSessions: 2, oauthClients: [] },
      agents: agentRows().filter((agent) => agent.userId === carla.userId),
      rules: null,
      recentRequests: [],
    })
  )

  await hoverCard(PersonHoverCard, id)
  expect(fetchDetail.mock.calls.map(([url]) => url)).toEqual([
    "/api/admin/users/usr%2Fcarla%3Fb%23c",
  ])
  expect(document.body.textContent).toContain(carla.displayName)
  expect(document.body.textContent).toContain("Sin correo")
  const agents = Array.from(document.querySelectorAll("dt")).find(
    (term) => term.textContent === "Agentes"
  )
  expect(agents?.parentElement?.querySelector("dd")?.textContent).toBe("1")
  expect(document.querySelector("a")?.getAttribute("href")).toBe(
    "/personas/usr%2Fcarla%3Fb%23c"
  )
})

it("consulta la solicitud al abrir y enlaza el resumen con su ID completo", async () => {
  const detail = requests[0]!.detail
  const id = "req/a?b#c"
  fetchDetail.mockResolvedValue(
    Response.json({ ...detail, summary: { ...detail.summary, id } })
  )

  await hoverCard(RequestHoverCard, id)
  expect(fetchDetail.mock.calls.map(([url]) => url)).toEqual([
    "/api/admin/requests/req%2Fa%3Fb%23c",
  ])
  expect(document.body.textContent).toContain(
    `${detail.summary.fromAddress} → ${detail.summary.toAddress}`
  )
  expect(document.querySelector("a")?.getAttribute("href")).toBe(
    "/solicitudes/req%2Fa%3Fb%23c"
  )
})

it.each([
  { Card: PersonHoverCard, entidad: "persona" },
  { Card: RequestHoverCard, entidad: "solicitud" },
])("avisa si falla la consulta de la $entidad", async ({ Card, entidad }) => {
  fetchDetail.mockResolvedValue(new Response(null, { status: 404 }))
  await hoverCard(Card, "desconocido")
  expect(document.body.textContent).toContain(
    `No se pudo cargar la ${entidad}.`
  )
  expect(document.querySelector("a")).toBeNull()
})
