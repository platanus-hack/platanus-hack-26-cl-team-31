// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ThemeProvider } from "./theme-provider"
import { TooltipProvider } from "./ui/tooltip"
import { WindowProvider, useTimeWindow } from "@/lib/window"
import { AppLayout } from "./app-layout"

vi.mock("./app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/lib/session", () => ({ useSession: () => ({ isOperator: false }) }))

function TimeWindowView() {
  const { window } = useTimeWindow()
  return <output>{window}</output>
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let router: ReturnType<typeof createMemoryRouter>
let client: QueryClient

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  router = createMemoryRouter([
    {
      Component: AppLayout,
      children: [{ index: true, Component: TimeWindowView }],
    },
  ])
  client = new QueryClient()
  await act(() =>
    root.render(
      <ThemeProvider defaultTheme="dark" disableTransitionOnChange={false}>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <WindowProvider>
              <RouterProvider router={router} />
            </WindowProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    )
  )
})

afterEach(async () => {
  await act(() => root.unmount())
  router.dispose()
  client.clear()
  host.remove()
  localStorage.clear()
  document.documentElement.classList.remove("dark", "light")
  vi.unstubAllGlobals()
})

it("aplica al contenido la ventana elegida en el encabezado", async () => {
  expect(host.querySelector("output")?.textContent).toBe("1h")
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label="Ventana de tiempo"]'
  )!
  await act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    )
  )
  const options = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]')
  )
  const day = options.find((option) =>
    option.textContent?.includes("24 horas")
  )!
  await act(() => day.click())
  expect(trigger.textContent).toBe("24h")
  expect(host.querySelector("output")?.textContent).toBe("24h")
})

it("alterna el tema desde el encabezado", async () => {
  const toggle = host.querySelector<HTMLButtonElement>(
    '[aria-label="Cambiar tema"]'
  )!
  await act(() => toggle.click())
  expect(document.documentElement.classList.contains("light")).toBe(true)
  await act(() => toggle.click())
  expect(document.documentElement.classList.contains("dark")).toBe(true)
})

it("abre la búsqueda y vuelve al panel con Escape", async () => {
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Buscar"]')!.click()
  )
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('[role="combobox"]')).not.toBeNull()
  await act(() =>
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
