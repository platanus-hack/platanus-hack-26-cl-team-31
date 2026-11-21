// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AdminSession } from "@shared/contract"
import { api, ApiError, devLogin } from "./api"
import { queryClient } from "./query"
import { SessionProvider, sessionQueryKey } from "./session"

vi.mock("./api", async (load) => ({
  ...await load<typeof import("./api")>(),
  api: vi.fn(),
  devLogin: vi.fn(),
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
  vi.restoreAllMocks()
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

it("permite reintentar el ingreso y confirma la renovación solo después de recargar la sesión", async () => {
  const success = vi.spyOn(toast, "success")
  queryClient.setQueryData(sessionQueryKey, {
    ...session,
    session: { ...session.session, fresh: false },
  })
  queryClient.setQueryData(["dev-login-probe"], true)
  queryClient.setQueryData(["audit"], ["lectura anterior"])
  await openSession()

  const stale = new ApiError("not_fresh", "Se requiere una sesión reciente", 403)
  const action = vi.fn().mockRejectedValue(stale)
  const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: action })
  await act(async () => {
    await expect(mutation.execute(undefined)).rejects.toBe(stale)
  })
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const login = Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === "Entrar como dev"
  )!

  vi.mocked(devLogin).mockRejectedValueOnce(new Error("Ingreso interrumpido"))
  await act(() => login.click())
  expect(devLogin).toHaveBeenCalledTimes(1)
  expect(dialog.isConnected).toBe(true)
  expect(login.disabled).toBe(false)
  expect(api).not.toHaveBeenCalled()
  expect(queryClient.getQueryData(["audit"])).toEqual(["lectura anterior"])
  expect(success).not.toHaveBeenCalled()

  let finishRefresh!: (value: AdminSession) => void
  const refresh = new Promise<AdminSession>((resolve) => { finishRefresh = resolve })
  vi.mocked(api).mockReturnValueOnce(refresh)
  vi.mocked(devLogin).mockResolvedValueOnce(undefined)
  await act(() => login.click())
  expect(vi.mocked(api).mock.calls.map(([route]) => route)).toEqual(["session"])
  expect(queryClient.getQueryData(["audit"])).toBeUndefined()
  expect(success).not.toHaveBeenCalled()

  await act(() => finishRefresh(session))
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host.textContent).toContain("Contenido privado")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  expect(queryClient.getQueryData(sessionQueryKey)).toEqual(session)
  expect(success).toHaveBeenCalledExactlyOnceWith("Sesión renovada. Repite la acción.")
  expect(action).toHaveBeenCalledTimes(1)
})
