// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { requests, userSummaries } from "@/mocks/fixtures"
import { CommandMenu } from "./command-menu"

let isOperator: boolean
vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator }) }))

function Palette() {
  const [open, setOpen] = useState(false)
  return <CommandMenu open={open} onOpenChange={setOpen} />
}

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

const user = userSummaries().find((person) => person.userId === "usr_ana")!
const request = requests.find(
  (row) => row.summary.toAddress === user.address
)!.summary
const fetchSearch = vi.fn(async (path: string) => {
  const items = path.startsWith("/api/admin/requests?") ? [request] : [user]
  return Response.json({ items, nextCursor: null })
})

beforeEach(async () => {
  isOperator = false
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchSearch.mockClear())
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  router = createMemoryRouter([{ path: "*", Component: Palette }])
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
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

async function shortcut(modifier: "ctrlKey" | "metaKey") {
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", [modifier]: true })
    )
  })
}

function input() {
  return document.querySelector<HTMLInputElement>('[role="combobox"]')
}

async function typeSearch(text: string) {
  const field = input()!
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!
    setter.call(field, text)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function options() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
}

it.each([
  ["req/a?b", "Abrir solicitud", "/solicitudes/req%2Fa%3Fb"],
  [
    "ABCDEF0123456789ABCDEF0123456789",
    "Abrir traza",
    "/trazas/ABCDEF0123456789ABCDEF0123456789",
  ],
  [
    "12345678-abcd-4000-8000-0123456789ab",
    "Abrir error",
    "/errores/12345678-abcd-4000-8000-0123456789ab",
  ],
  ["a@b.cl", "Abrir persona", "/personas/a%40b.cl"],
  ["usr_ana", "Abrir persona", "/personas/usr_ana"],
])("prioriza y abre el detalle de %s", async (id, label, path) => {
  await shortcut("ctrlKey")
  await typeSearch(`  ${id}  `)
  const first = options()[0]
  expect(first.textContent).toContain(label)
  await act(() => first.click())
  expect(router.state.location.pathname).toBe(path)
  expect(input()).toBeNull()
  await shortcut("metaKey")
  expect(input()?.value).toBe("")
})

it.each([false, true])(
  "filtra páginas por texto y rol (operador = %s)",
  async (operator) => {
    isOperator = operator
    await shortcut("metaKey")
    await typeSearch("  ToKeN  ")
    const tokens = options().find(
      (option) => option.textContent === "Tokens MCP"
    )
    expect(options().some((option) => option.textContent === "Resumen")).toBe(
      false
    )
    if (operator) {
      expect(tokens).toBeDefined()
      await act(() => tokens!.click())
      expect(router.state.location.pathname).toBe("/tokens")
    } else {
      expect(tokens).toBeUndefined()
    }
  }
)

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

it.each(["solicitud", "persona"])(
  "busca el último término y abre la %s encontrada",
  async (kind) => {
    await shortcut("ctrlKey")
    await typeSearch("a")
    await advance(200)
    expect(fetchSearch).not.toHaveBeenCalled()
    await typeSearch("an")
    await advance(100)
    await typeSearch("  ana  ")
    await advance(199)
    expect(fetchSearch).not.toHaveBeenCalled()
    await advance(1)
    const queries = fetchSearch.mock.calls.map(([path]) => {
      const url = new URL(path, window.location.href)
      return {
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
      }
    })
    expect(queries).toHaveLength(2)
    expect(queries).toEqual(
      expect.arrayContaining([
        { path: "/api/admin/requests", params: { q: "ana", limit: "5" } },
        { path: "/api/admin/users", params: { q: "ana", limit: "5" } },
      ])
    )
    // React Query notifica a los suscriptores después de recibir ambas respuestas.
    await advance(1)
    const byText = (text: string) =>
      options().find((item) => item.textContent?.includes(text))
    const requestOption = byText(request.id)!
    const userOption = byText(user.displayName!)!
    expect(requestOption.textContent).toContain(request.toAddress)
    expect(userOption.textContent).toContain(user.address)
    await act(() => (kind === "solicitud" ? requestOption : userOption).click())
    expect(router.state.location.pathname).toBe(
      kind === "solicitud"
        ? `/solicitudes/${request.id}`
        : `/personas/${user.userId}`
    )
  }
)

it("omite la búsqueda pendiente si se cierra el menú con el atajo", async () => {
  await shortcut("metaKey")
  await typeSearch("ana")
  await shortcut("metaKey")
  await advance(200)
  expect(input()).toBeNull()
  expect(fetchSearch).not.toHaveBeenCalled()
})
