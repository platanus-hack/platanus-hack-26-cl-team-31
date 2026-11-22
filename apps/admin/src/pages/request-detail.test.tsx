// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { overviewQuery } from "@/lib/queries"
import { NOW, requests } from "@/mocks/fixtures"
import { RequestDetailPage } from "./request-detail"

let isOperator: boolean
vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator }) }))

const request = vi.fn<typeof fetch>()
const id = "req_detalle"
const path = `/api/admin/requests/${id}`

function detail(
  status: "awaiting_agent" | "awaiting_owner" | "expired" | "answered",
  ttl = 60_000
) {
  const fixture = requests.find((row) => row.summary.status === status)!.detail
  return {
    ...fixture,
    summary: {
      ...fixture.summary,
      id,
      expiresAt: new Date(NOW + ttl).toISOString(),
    },
  }
}

let host: HTMLDivElement
let root: Root
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", request)
  isOperator = true
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(() => root.unmount())
  client.clear()
  host.remove()
  request.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

async function open(data: ReturnType<typeof detail>) {
  request.mockResolvedValueOnce(Response.json(data))
  await act(() =>
    root.render(
      <MemoryRouter initialEntries={[`/solicitudes/${id}`]}>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Routes>
              <Route path="/solicitudes/:id" element={<RequestDetailPage />} />
            </Routes>
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  )
  await advance(1)
  expect(host.querySelector("h1")?.textContent).toContain(id)
}

function button(label: string, scope: ParentNode = host) {
  return Array.from(scope.querySelectorAll("button")).find(
    (item) => item.textContent === label
  )
}

it("muestra al viewer las llaves del payload sin ofrecer revelación ni mutaciones", async () => {
  isOperator = false
  const data = detail("answered")
  await open(data)
  expect(button("Reintentar aviso")).toBeUndefined()
  expect(button("Expirar")).toBeUndefined()
  expect(button("Revelar payload")).toBeUndefined()

  await act(() => button("Payload")!.focus())
  const panel = host.querySelector('[role="tabpanel"]:not([hidden])')
  expect(panel?.textContent).toContain("Solo operadores")
  for (const key of [...data.argsKeys, ...data.resultKeys]) {
    expect(panel?.textContent).toContain(key)
  }
  expect(button("Revelar payload")).toBeUndefined()
  expect(request).toHaveBeenCalledExactlyOnceWith(
    path,
    expect.objectContaining({ method: "GET" })
  )
})

it.each([
  ["awaiting_agent", 60_000, true, true],
  ["awaiting_agent", 0, false, true],
  ["awaiting_agent", -1, false, true],
  ["awaiting_owner", 60_000, false, true],
  ["answered", 60_000, false, false],
] as const)(
  "habilita acciones según el estado %s y el plazo restante de %i ms",
  async (status, ttl, rewake, expire) => {
    await open(detail(status, ttl))
    expect(button("Reintentar aviso")!.disabled).toBe(!rewake)
    expect(button("Expirar")!.disabled).toBe(!expire)
    expect(button("Revelar payload")).toBeDefined()
  }
)

it.each([
  ["Reintentar aviso", "Reintentar", "rewake"],
  ["Expirar", "Expirar", "expire"],
] as const)(
  "envía «%s» con su motivo y refresca las vistas de la solicitud",
  async (action, confirm, endpoint) => {
    const list = ["requests", { stuck: true, limit: 8 }]
    const overview = overviewQuery("1h").queryKey
    client.getQueryCache().build(client, { queryKey: list })
    client.getQueryCache().build(client, { queryKey: overview })
    const initial = detail("awaiting_agent")
    await open(initial)
    await act(() => button(action)!.click())
    const dialog = document.querySelector('[role="alertdialog"]')!
    const reason = "Seguimiento del incidente"
    const field = dialog.querySelector("textarea")!
    await act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!
      setter.call(field, reason)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const next =
      endpoint === "expire" ? detail("expired") : detail("awaiting_agent")
    if (endpoint === "rewake")
      next.summary.wakeAttempts = initial.summary.wakeAttempts + 1
    request
      .mockResolvedValueOnce(
        Response.json({ ok: true, auditId: "audit_detalle" })
      )
      .mockResolvedValueOnce(Response.json(next))

    await act(() => button(confirm, dialog)!.click())
    await advance(1)
    expect(request).toHaveBeenNthCalledWith(
      2,
      `${path}/${endpoint}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason }),
      })
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      path,
      expect.objectContaining({ method: "GET" })
    )
    expect(client.getQueryState(list)?.isInvalidated).toBe(true)
    expect(client.getQueryState(overview)?.isInvalidated).toBe(true)
    if (endpoint === "expire") {
      expect(host.querySelector("h1")?.textContent).toContain("Vencida")
    } else {
      expect(host.textContent).toContain(`${next.summary.wakeAttempts} intento`)
    }
  }
)

it.each(["awaiting_agent", "awaiting_owner"] as const)(
  "refresca %s y deja de consultar al recibir el cierre",
  async (status) => {
    await open(detail(status))
    request.mockResolvedValueOnce(Response.json(detail("answered")))
    await advance(5_000)
    await advance(1)
    expect(host.querySelector("h1")?.textContent).toContain("Respondida")
    await advance(15_000)
    expect(request).toHaveBeenCalledTimes(2)
  }
)
