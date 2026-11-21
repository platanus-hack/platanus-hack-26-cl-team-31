// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { tokens } from "@/mocks/fixtures"
import { TokensPage } from "./tokens"

vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator: true }) }))

it("exige un permiso, envía solo los elegidos y restablece la selección al crear otro token", async ({
  onTestFinished,
}) => {
  const create = vi.fn((_path: RequestInfo | URL, _init: RequestInit) =>
    Response.json({ token: "sba_fixture", meta: tokens[0] })
  )
  vi.stubGlobal("fetch", async (path: RequestInfo | URL, init: RequestInit) =>
    init.method === "POST" ? create(path, init) : Response.json({ items: [] })
  )
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const client = new QueryClient()
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  onTestFinished(async () => {
    await act(() => root.unmount())
    client.clear()
    host.remove()
    vi.unstubAllGlobals()
  })
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <TokensPage />
      </QueryClientProvider>
    )
  )

  const open = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Crear token"
  )!
  const scope = (name: string) => document.getElementById(`scope-${name}`)!
  await act(() => open.click())
  expect(scope("admin:read").getAttribute("aria-checked")).toBe("true")
  expect(scope("admin:sql").getAttribute("aria-checked")).toBe("false")

  const name = document.getElementById("token-name")!
  const submit = document.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  )!
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!
    setter.call(name, "Informe SQL")
    name.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(submit.disabled).toBe(false)
  await act(() => scope("admin:read").click())
  expect(submit.disabled).toBe(true)
  await act(() => submit.click())
  expect(create).not.toHaveBeenCalled()

  await act(() => scope("admin:sql").click())
  await act(() => submit.click())
  expect(create).toHaveBeenCalledTimes(1)
  const [path, init] = create.mock.calls[0]!
  expect(path).toBe("/api/admin/tokens")
  expect(JSON.parse(String(init.body)).scopes).toEqual(["admin:sql"])

  const done = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Listo, ya lo copié"
  )!
  await act(() => done.click())
  await act(() => open.click())
  expect(scope("admin:read").getAttribute("aria-checked")).toBe("true")
  expect(scope("admin:sql").getAttribute("aria-checked")).toBe("false")
})
