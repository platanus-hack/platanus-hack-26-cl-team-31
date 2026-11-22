// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query"
import type { Window as HappyWindow } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { toast } from "sonner"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AdminSession } from "@shared/contract"

import { api } from "@/lib/api"
import { queryClient } from "@/lib/query"
import { overviewQuery } from "@/lib/queries"
import { SessionProvider, sessionQueryKey } from "@/lib/session"
import { WindowProvider } from "@/lib/window"
import * as mockApi from "@/mocks/handlers"
import { AppSidebar } from "./app-sidebar"
import { ThemeProvider } from "./theme-provider"
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar"
import { TooltipProvider } from "./ui/tooltip"

vi.hoisted(() => vi.stubEnv("VITE_ADMIN_MOCK", "1"))

let host: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>
const viewport = (window as unknown as HappyWindow).happyDOM
const desktopWidth = window.innerWidth

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  router.dispose()
  queryClient.clear()
  host.remove()
  localStorage.clear()
  document.documentElement.classList.remove("dark", "light")
  viewport.setViewport({ width: desktopWidth })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterAll(() => vi.unstubAllEnvs())

async function openSidebar(
  path: string,
  role: "operator" | "viewer" = "viewer"
) {
  mockApi.writeMockState({ role })
  queryClient.setQueryData(sessionQueryKey, await api("session"))
  router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <SidebarProvider>
            <AppSidebar />
            <SidebarTrigger />
          </SidebarProvider>
        ),
      },
    ],
    { initialEntries: [path] }
  )
  await act(() =>
    root.render(
      <ThemeProvider defaultTheme="light" disableTransitionOnChange={false}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <WindowProvider>
              <TooltipProvider>
                <RouterProvider router={router} />
              </TooltipProvider>
            </WindowProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    )
  )
}

function menuLink(path: string) {
  return document.querySelector<HTMLAnchorElement>(
    `[data-sidebar="content"] a[href="${path}"]`
  )
}

async function openUserMenu() {
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-sidebar="footer"] button[aria-haspopup="menu"]'
  )!
  await act(() => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  })
}

function menuItem(label: string) {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]')
  ).find((element) => element.textContent === label)
  expect(item, label).toBeDefined()
  return item!
}

async function openSimulation() {
  await openUserMenu()
  await act(() => menuItem("Simulación (mock)").click())
}

async function waitForView(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {})
    check()
  })
}

it("aplica el tema elegido en el menú y recuerda la selección al abrirlo de nuevo", async () => {
  await openSidebar("/")
  await openUserMenu()
  expect(menuItem("Claro").getAttribute("aria-checked")).toBe("true")
  await act(() => menuItem("Oscuro").click())
  expect(localStorage.getItem("theme")).toBe("dark")
  expect(document.documentElement.classList.contains("dark")).toBe(true)
  await openUserMenu()
  expect(menuItem("Oscuro").getAttribute("aria-checked")).toBe("true")
})

it("habilita la navegación de operador al cambiar el rol simulado desde el menú", async () => {
  await openSidebar("/", "viewer")
  expect(menuLink("/tokens")).toBeNull()
  await openSimulation()
  expect(menuItem("Lector").getAttribute("aria-checked")).toBe("true")
  await act(() => menuItem("Operador").click())
  await waitForView(() =>
    expect(menuLink("/tokens")?.textContent).toBe("Tokens MCP")
  )
  expect(queryClient.getQueryData<AdminSession>(sessionQueryKey)).toMatchObject({
    user: { role: "operator" },
    session: { fresh: true },
  })
})

it("conserva el acceso de operador al desactivar la frescura de la sesión desde el menú", async () => {
  await openSidebar("/", "operator")
  await openSimulation()
  expect(menuItem("Sesión fresca").getAttribute("aria-checked")).toBe("true")
  await act(() => menuItem("Sesión fresca").click())
  await waitForView(() => {
    expect(
      queryClient.getQueryData<AdminSession>(sessionQueryKey)
    ).toMatchObject({
      user: { role: "operator" },
      session: { fresh: false },
    })
    expect(menuLink("/tokens")).not.toBeNull()
  })
  await openSimulation()
  expect(menuItem("Sesión fresca").getAttribute("aria-checked")).toBe("false")
})

it("avisa si falla el cierre de sesión y permite reintentarlo hasta volver al ingreso", async () => {
  const error = vi.spyOn(toast, "error")
  vi.spyOn(mockApi, "mockSignOut").mockRejectedValueOnce(
    new Error("Sin conexión")
  )
  await openSidebar("/")
  await openUserMenu()
  await act(() => menuItem("Cerrar sesión").click())
  expect(error).toHaveBeenCalledExactlyOnceWith("No se pudo cerrar la sesión.")
  expect(menuLink("/auditoria")).not.toBeNull()

  await openUserMenu()
  await act(() => menuItem("Cerrar sesión").click())
  await waitForView(() => {
    expect(host.textContent).toContain("Entrar con Google")
    expect(menuLink("/auditoria")).toBeNull()
  })
})

it.each(["viewer", "operator"] as const)(
  "muestra la navegación correspondiente al rol %s",
  async (role) => {
    await openSidebar("/", role)
    expect(menuLink("/")?.dataset.active).toBe("true")
    expect(menuLink("/auditoria")?.textContent).toBe("Auditoría")
    expect(menuLink("/flujo")?.textContent).toBe("Flujo")
    if (role === "operator")
      expect(menuLink("/tokens")?.textContent).toBe("Tokens MCP")
    else expect(menuLink("/tokens")).toBeNull()
  }
)

it("marca la sección de un detalle y descarta prefijos de otra ruta", async () => {
  await openSidebar("/trazas/detalle")
  expect(menuLink("/trazas")?.dataset.active).toBe("true")
  expect(menuLink("/")?.dataset.active).toBe("false")

  await act(() => router.navigate("/trazas-extra"))
  expect(menuLink("/trazas")?.dataset.active).toBe("false")
})

it("muestra las solicitudes atascadas y los errores de la ventana y oculta los ceros", async () => {
  const summary = await queryClient.fetchQuery(overviewQuery("1h"))
  const key = overviewQuery("1h").queryKey
  const counts = (stuck: number, total: number) => ({
    ...summary,
    requests: { ...summary.requests, stuck },
    errors: { ...summary.errors, total },
  })
  const badge = (path: string) =>
    menuLink(path)?.closest("li")?.querySelector('[data-sidebar="menu-badge"]')

  queryClient.setQueryData(key, counts(3, 7))
  await openSidebar("/")
  expect(badge("/solicitudes")?.textContent).toBe("3")
  expect(badge("/errores")?.textContent).toBe("7")

  await act(() => {
    queryClient.setQueryData(key, counts(0, 0))
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(badge("/solicitudes")).toBeNull()
    expect(badge("/errores")).toBeNull()
  })
})

it("cierra el menú móvil al navegar desde un enlace", async () => {
  viewport.setViewport({ width: 390 })
  await openSidebar("/")
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-sidebar="trigger"]'
  )!
  await act(() => trigger.click())
  const dialog = document.querySelector('[role="dialog"]')!
  const link = dialog.querySelector<HTMLAnchorElement>('a[href="/avisos"]')!
  await act(() => link.click())
  expect(router.state.location.pathname).toBe("/avisos")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
