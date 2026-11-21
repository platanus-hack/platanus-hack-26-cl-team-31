// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { requests } from "@/mocks/fixtures"
import { RequestsPage } from "./requests"

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

const fetchRequests = vi.fn<(path: string) => Promise<Response>>(async () =>
  Response.json({ items: [], nextCursor: null })
)

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchRequests.mockClear())
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(() => root.unmount())
  router.dispose()
  client.clear()
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openRequests(search: string) {
  router = createMemoryRouter(
    [{ path: "/solicitudes", Component: RequestsPage }],
    {
      initialEntries: [`/solicitudes?${search}`],
    }
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
}

// La URL del panel permite compartir la vista. La API recibe los mismos filtros y el límite de página.
function expectFilters(search: string) {
  const filters = new URLSearchParams(search)
  filters.sort()
  const location = new URLSearchParams(router.state.location.search)
  location.sort()
  expect(location.toString()).toBe(filters.toString())

  const [path] = fetchRequests.mock.lastCall!
  const url = new URL(path, window.location.href)
  expect(url.pathname).toBe("/api/admin/requests")
  filters.set("limit", "50")
  filters.sort()
  url.searchParams.sort()
  expect(url.searchParams.toString()).toBe(filters.toString())
}

function searchField() {
  return host.querySelector<HTMLInputElement>(
    'input[aria-label="Prefijo de request id"]'
  )!
}

async function typePrefix(value: string) {
  const input = searchField()
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

function control(selector: string, text: string) {
  const element = Array.from(
    document.querySelectorAll<HTMLElement>(selector)
  ).find((item) => item.textContent === text)
  expect(element, text).toBeDefined()
  return element!
}

async function openOptions(trigger: HTMLElement) {
  await act(() => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  })
}

it("busca el último prefijo y permite borrarlo conservando los otros filtros", async () => {
  await openRequests("status=denied")
  await typePrefix("req")
  await advance(200)
  await typePrefix("req_ana")
  await advance(249)
  expect(fetchRequests).toHaveBeenCalledTimes(1)
  expectFilters("status=denied")
  await advance(1)
  expect(fetchRequests).toHaveBeenCalledTimes(2)
  expectFilters("status=denied&q=req_ana")

  await act(() =>
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Limpiar"]')!
      .click()
  )
  await advance(250)
  expectFilters("status=denied")
})

it("descarta la búsqueda pendiente cuando cambia el prefijo desde la URL", async () => {
  await openRequests("q=primero")
  await typePrefix("pendiente")
  await advance(100)
  await act(() => router.navigate("/solicitudes?q=segundo"))
  expect(searchField().value).toBe("segundo")
  await advance(250)
  expectFilters("q=segundo")
  expect(fetchRequests).toHaveBeenCalledTimes(2)
})

it("combina estados, quita uno y limpia la selección sin perder la dirección", async () => {
  await openRequests("address=ana&status=answered")
  const trigger = host.querySelector<HTMLElement>(
    'button[aria-haspopup="menu"]'
  )!
  await openOptions(trigger)
  const status = (label: string) => control('[role="menuitemcheckbox"]', label)
  await act(() => status("Denegada").click())
  expectFilters("address=ana&status=answered&status=denied")
  await act(() => status("Respondida").click())
  expectFilters("address=ana&status=denied")
  await act(() => control('[role="menuitem"]', "Limpiar selección").click())
  expectFilters("address=ana")
})

it("vuelve a todas las herramientas y limpia los filtros restantes", async () => {
  await openRequests("q=req")
  const tool = host.querySelector<HTMLElement>('[aria-label="Herramienta"]')!
  await openOptions(tool)
  await act(() => control('[role="option"]', "Pregunta").click())
  expectFilters("q=req&tool=question")
  await openOptions(tool)
  await act(() => control('[role="option"]', "Todas las herramientas").click())
  expectFilters("q=req")
  await act(() => control("button", "Limpiar").click())
  expectFilters("")
  expect(searchField().value).toBe("")
})

it("carga la página siguiente del mismo filtro una sola vez y conserva las solicitudes anteriores", async () => {
  const [{ summary: first }, { summary: second }] = requests
  const cursor = "página+2/="
  let finishPage!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => {
    finishPage = resolve
  })
  fetchRequests
    .mockResolvedValueOnce(
      Response.json({ items: [first], nextCursor: cursor })
    )
    .mockImplementationOnce(() => pending)

  const loadMore = () =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Cargar más"
    )
  const requestLinks = () =>
    Array.from(host.querySelectorAll("tbody a"), (link) =>
      link.getAttribute("href")
    )

  await openRequests("q=req_")
  await advance(1)
  expectFilters("q=req_")
  expect(requestLinks()).toEqual([`/solicitudes/${first.id}`])
  await act(() => loadMore()!.click())
  await advance(1)
  const [path] = fetchRequests.mock.lastCall!
  const url = new URL(path, window.location.href)
  expect(url.searchParams.get("cursor")).toBe(cursor)
  expect(url.searchParams.get("q")).toBe("req_")
  expect(loadMore()?.disabled).toBe(true)
  await act(() => loadMore()!.click())
  expect(fetchRequests).toHaveBeenCalledTimes(2)

  finishPage(Response.json({ items: [second], nextCursor: null }))
  await advance(1)
  expect(requestLinks()).toEqual([
    `/solicitudes/${first.id}`,
    `/solicitudes/${second.id}`,
  ])
  expect(loadMore()).toBeUndefined()
})
