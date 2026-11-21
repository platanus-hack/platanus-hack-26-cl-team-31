// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { AdminSession } from "@shared/contract"
import { api, ApiError } from "./api"
import { queryClient } from "./query"
import { SessionProvider, sessionQueryKey } from "./session"

vi.mock("./api", async (load) => ({
  ...await load<typeof import("./api")>(),
  api: vi.fn(),
  probeDevLogin: vi.fn().mockResolvedValue(false),
}))

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

it.each(["unauthorized", "forbidden"] as const)("drops cached admin reads when session refresh returns %s", async (code) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const now = new Date().toISOString()
  const session: AdminSession = {
    user: { id: "op", email: "op@example.test", role: "operator", image: null, name: "Operador" },
    session: { id: "s", createdAt: now, expiresAt: now, fresh: true },
  }
  queryClient.setQueryData(sessionQueryKey, session)
  queryClient.setQueryData(["audit"], ["cached entry"])
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    await act(() => root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(SessionProvider, { children: "Contenido privado" }))))
    expect(host.textContent).toContain("Contenido privado")
    vi.mocked(api).mockRejectedValueOnce(new ApiError(code, code, code === "forbidden" ? 403 : 401))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(host.textContent).not.toContain("Contenido privado")
    expect(queryClient.getQueryData(["audit"])).toBeUndefined()
  } finally {
    await act(() => root.unmount())
  }
})
