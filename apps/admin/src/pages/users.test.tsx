// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { userSummaries } from "@/mocks/fixtures"
import { UsersPage } from "./users"

const [first, second, third] = userSummaries()
const fetchUsers = vi.fn<(path: string) => Promise<Response>>()
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let router: ReturnType<typeof createMemoryRouter>
let client: QueryClient

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchUsers.mockReset())
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

async function openList(path = "/personas") {
  router = createMemoryRouter(
    [
      { path: "/personas", Component: UsersPage },
      { path: "/personas/:id", element: <h1>Ficha de persona</h1> },
    ],
    { initialEntries: [path] }
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
}

it("pagina la búsqueda de la URL y vuelve al listado inicial al limpiarla", async () => {
  const cursor = "siguiente+/="
  fetchUsers
    .mockResolvedValueOnce(
      Response.json({ items: [first], nextCursor: cursor })
    )
    .mockResolvedValueOnce(Response.json({ items: [second], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ items: [third], nextCursor: null }))

  await openList("/personas?q=sideband")
  const search = host.querySelector<HTMLInputElement>(
    '[aria-label="Buscar persona"]'
  )!
  expect(search.value).toBe("sideband")
  const visibleRows = () =>
    Array.from(host.querySelectorAll("tbody tr"), (row) => row.textContent)
  expect(visibleRows()).toEqual([expect.stringContaining(first.address!)])
  const more = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Cargar más"
  )!
  await act(() => more.click())
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(visibleRows()).toEqual([
    expect.stringContaining(first.address!),
    expect.stringContaining(second.address!),
  ])

  await act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Limpiar"]')!.click()
  )
  await act(() => vi.advanceTimersByTimeAsync(250))
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(router.state.location.search).toBe("")
  expect(visibleRows()).toEqual([expect.stringContaining(third.address!)])
  const requests = fetchUsers.mock.calls.map(([path]) => {
    const url = new URL(path, window.location.href)
    expect(url.pathname).toBe("/api/admin/users")
    return Object.fromEntries(url.searchParams)
  })
  expect(requests).toEqual([
    { q: "sideband", limit: "50" },
    { q: "sideband", limit: "50", cursor },
    { limit: "50" },
  ])
})

it("abre la ficha de la persona elegida con su id completo", async () => {
  const person = { ...second, userId: "ana/equipo?2#sur" }
  fetchUsers.mockResolvedValueOnce(
    Response.json({ items: [first, person], nextCursor: null })
  )
  await openList()
  const row = Array.from(
    host.querySelectorAll<HTMLTableRowElement>("tbody tr")
  ).find((item) => item.textContent.includes(person.address!))!
  await act(() => row.click())
  expect(router.state.matches.at(-1)?.params.id).toBe(person.userId)
  expect(host.querySelector("h1")?.textContent).toBe("Ficha de persona")
})
