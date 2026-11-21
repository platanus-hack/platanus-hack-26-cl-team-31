// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AdminSession } from "@shared/contract"
import { api, ApiError } from "./api"
import { queryClient } from "./query"
import { SessionProvider, sessionQueryKey } from "./session"

vi.mock("./api", async (load) => ({
  ...await load<typeof import("./api")>(),
  api: vi.fn(),
  probeDevLogin: vi.fn().mockResolvedValue(false),
}))

const now = new Date().toISOString()
const session: AdminSession = {
  user: { id: "op", email: "op@example.test", role: "operator", image: null, name: "Operador" },
  session: { id: "s", createdAt: now, expiresAt: now, fresh: true },
}
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  queryClient.clear()
  vi.mocked(api).mockReset()
  vi.unstubAllGlobals()
})

async function openSession() {
  await act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
    createElement(SessionProvider, { children: "Contenido privado" }))))
}

it.each(["unauthorized", "forbidden"] as const)("drops cached admin reads when session refresh returns %s", async (code) => {
  queryClient.setQueryData(sessionQueryKey, session)
  queryClient.setQueryData(["audit"], ["cached entry"])
  await openSession()
  expect(host.textContent).toContain("Contenido privado")
  vi.mocked(api).mockRejectedValueOnce(new ApiError(code, code, code === "forbidden" ? 403 : 401))
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(host.textContent).not.toContain("Contenido privado")
  expect(queryClient.getQueryData(["audit"])).toBeUndefined()
})

it("permite reintentar tras un fallo temporal al cargar la sesión", async () => {
  const error = new ApiError("upstream", "Servicio temporalmente fuera de línea", 503)
  let rejectRequest!: (error: Error) => void
  const pending = new Promise<never>((_, reject) => { rejectRequest = reject })
  vi.mocked(api).mockReturnValueOnce(pending).mockResolvedValueOnce(session)

  await openSession()
  expect(host.textContent).toContain("Cargando sesión")
  expect(host.textContent).not.toContain("Contenido privado")
  expect(host.querySelector("button")).toBeNull()

  await act(() => rejectRequest(error))
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.textContent).toContain(error.message)
  })
  expect(host.textContent).toContain("No se pudo contactar al servidor admin")
  expect(host.textContent).not.toContain("Contenido privado")
  const retry = host.querySelector("button")
  expect(retry?.textContent).toBe("Reintentar")
  await act(() => retry!.click())
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.textContent).toContain("Contenido privado")
  })
  expect(host.textContent).not.toContain(error.message)
  expect(vi.mocked(api).mock.calls.map(([route]) => route)).toEqual(["session", "session"])
})
