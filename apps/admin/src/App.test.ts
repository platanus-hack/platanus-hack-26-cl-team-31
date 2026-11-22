// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest"

import App from "./App"
import { errorQuery } from "@/lib/queries"
import { queryClient } from "@/lib/query"
import { audit, errorEvents, errors, NOW } from "@/mocks/fixtures"
import { writeMockState } from "@/mocks/handlers"
import * as live from "@/mocks/live"

vi.hoisted(() => vi.stubEnv("VITE_ADMIN_MOCK", "1"))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  queryClient.clear()
  vi.useRealTimers()
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterAll(() => vi.unstubAllEnvs())

async function openApp(path: string) {
  await act(() => {
    window.history.replaceState(null, "", path)
    window.dispatchEvent(new PopStateEvent("popstate"))
    root.render(createElement(App))
  })
}

// Espera los import() del router y avanza la latencia de la API simulada dentro
// de act. Así cada reintento lee el DOM actualizado sin esperar esos 100 ms reales.
async function waitForView(assertView: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await vi.dynamicImportSettled()
        await vi.advanceTimersByTimeAsync(100)
      })
      assertView()
    },
    { interval: 0, timeout: 3000 }
  )
}

it("mantiene el error del callback hasta iniciar sesión y vuelve al resumen", async () => {
  writeMockState({ loggedIn: false })
  await openApp("/login?error=access_denied")

  await waitForView(() =>
    expect(host.textContent).toContain("Correo no autorizado")
  )
  expect(window.location.search).toBe("?error=access_denied")
  expect(host.querySelector('nav[aria-label="breadcrumb"]')).toBeNull()

  const login = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent.includes("Entrar como dev")
  )
  expect(login).toBeDefined()
  const historyLength = window.history.length
  await act(() => login!.click())

  await waitForView(() =>
    expect(host.querySelector("h1")?.textContent).toBe("Resumen")
  )
  expect(window.location.pathname + window.location.search).toBe("/")
  expect(window.history.length).toBe(historyLength)
})

it("abre el detalle de una traza por URL y vuelve al listado por el breadcrumb", async () => {
  const id = "0123456789abcdef0123456789abcdef"
  await openApp(`/trazas/${id}`)

  const breadcrumb = 'nav[aria-label="breadcrumb"]'
  await waitForView(() =>
    expect(host.querySelector("h1")?.textContent).toContain(`Traza ${id}`)
  )
  expect(
    host.querySelector(`${breadcrumb} [aria-current="page"]`)?.textContent
  ).toBe(id)
  const list = host.querySelector<HTMLAnchorElement>(`${breadcrumb} a`)
  expect(list?.textContent).toBe("Trazas")
  expect(list?.getAttribute("href")).toBe("/trazas")
  await act(() => list!.click())

  await waitForView(() =>
    expect(host.querySelector("h1")?.textContent).toBe("Trazas")
  )
  expect(window.location.pathname).toBe("/trazas")
})

it("abre desde un error la solicitud con su identificador completo", async () => {
  const event = { ...errorEvents[0]!, requestId: "req/a?b#c" }
  const errorId = event.errorId!
  queryClient.setQueryData(errorQuery(errorId).queryKey, event)
  await openApp(`/errores/${errorId}`)

  const links = () =>
    Array.from(
      document.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a')
    )
  const reference = () =>
    links().find((link) => link.textContent === event.requestId)
  await waitForView(() => expect(reference()).toBeDefined())
  const path = "/solicitudes/req%2Fa%3Fb%23c"
  expect(reference()!.getAttribute("href")).toBe(path)
  expect(
    links()
      .find((link) => link.textContent === "Ver solicitud")
      ?.getAttribute("href")
  ).toBe(path)
  await act(() => reference()!.click())

  await waitForView(() =>
    expect(
      host.querySelector('nav[aria-label="breadcrumb"] [aria-current="page"]')
        ?.textContent
    ).toBe(event.requestId)
  )
})

it("combina ventana, servicio y operación y recalcula las ocurrencias de los grupos visibles", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW)
  await openApp("/errores")
  const withinHours = (hours: number) =>
    errors.filter(
      (group) => Date.parse(group.lastAt) >= NOW - hours * 3_600_000
    )
  const daily = withinHours(24)
  const broker = daily.filter((group) => group.service === "broker")
  const replies = broker.filter((group) => group.operation.includes("POST"))

  async function expectGroups(groups: typeof errors) {
    const ordered = groups.toSorted((a, b) => b.count - a.count)
    const total = groups.reduce((sum, group) => sum + group.count, 0)
    await waitForView(() => {
      const rows = Array.from(
        host.querySelectorAll<HTMLTableRowElement>("tbody tr")
      )
      expect(rows.map((row) => row.cells[1]?.textContent)).toEqual(
        ordered.map((group) => group.operation)
      )
      expect(host.textContent).toContain(` · ${total} ocurrencias`)
    })
  }

  async function selectOption(label: string, optionText: string) {
    const trigger = host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
    await act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    )
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]')
    ).find((item) => item.textContent.includes(optionText))
    expect(option).toBeDefined()
    await act(() => option!.click())
  }

  await expectGroups(withinHours(1))
  await selectOption("Ventana de tiempo", "24 horas")
  await expectGroups(daily)
  await selectOption("Servicio", "broker")
  await expectGroups(broker)

  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Operación"]'
  )!
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!
    setter.call(input, "POST")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await expectGroups(replies)
  const clear = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Limpiar"
  )!
  await act(() => clear.click())
  await expectGroups(daily)
  expect(input.value).toBe("")
})

it("abre la muestra del grupo seleccionado, permite copiar sus frames y vuelve a la lista", async () => {
  const sample = errorEvents.find(
    (event) => event.service === "mcp" && event.attrs.issues
  )!
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  await openApp("/errores")

  const row = () =>
    Array.from(host.querySelectorAll<HTMLTableRowElement>("tbody tr")).find(
      (item) => item.textContent.includes(String(sample.attrs.operation))
    )
  await waitForView(() => expect(row()).toBeDefined())
  await act(() => row()!.click())

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  await waitForView(() => {
    expect(dialog()?.textContent).toContain(sample.attrs.issues)
    expect(dialog()?.textContent).toContain(sample.attrs.frames)
  })
  expect(window.location.pathname).toBe(`/errores/${sample.errorId}`)
  const copy = dialog()!.querySelector<HTMLButtonElement>(
    '[aria-label="Copiar frames"]'
  )!
  await act(() => copy.click())
  expect(write).toHaveBeenCalledExactlyOnceWith(sample.attrs.frames)

  const close = Array.from(dialog()!.querySelectorAll("button")).find(
    (button) => button.textContent === "Close"
  )!
  await act(() => close.click())
  await waitForView(() => {
    expect(window.location.pathname).toBe("/errores")
    expect(dialog()).toBeNull()
    expect(row()).toBeDefined()
  })
})

it("copia los atributos del evento seleccionado en En vivo y abre su solicitud", async () => {
  const event = { ...errorEvents[0]!, requestId: "req/a?b#c" }
  vi.spyOn(live, "startMockLive").mockImplementation((_filters, handlers) => {
    handlers.onStatus("open")
    handlers.onEvent(event)
    handlers.onEvent(errorEvents[1]!)
    return () => {}
  })
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  await openApp("/en-vivo")

  const row = () =>
    Array.from(host.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((tr) =>
      tr.textContent.includes(event.requestId)
    )
  await waitForView(() => expect(row()).toBeDefined())
  await act(() => row()!.click())

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const attrs = dialog.querySelector("pre")!.textContent
  expect(JSON.parse(attrs)).toEqual(event.attrs)
  const copy = dialog.querySelector<HTMLButtonElement>(
    '[aria-label="Copiar attrs"]'
  )!
  await act(() => copy.click())
  expect(write).toHaveBeenCalledExactlyOnceWith(attrs)
  await waitForView(() => expect(host.textContent).toContain("Copiado"))

  const request = Array.from(dialog.querySelectorAll("a")).find(
    (link) => link.textContent === "Solicitud"
  )!
  expect(request.getAttribute("href")).toBe("/solicitudes/req%2Fa%3Fb%23c")
  await act(() => request.click())
  await waitForView(() =>
    expect(
      host.querySelector('nav[aria-label="breadcrumb"] [aria-current="page"]')
        ?.textContent
    ).toBe(event.requestId)
  )
})

it("permite a un viewer recorrer la auditoría sin perder la atribución de cada acción", async () => {
  writeMockState({ loggedIn: true, role: "viewer" })
  await openApp("/auditoria")

  const loadMore = () =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Cargar más"
    )
  const rows = () =>
    Array.from(host.querySelectorAll<HTMLTableRowElement>("tbody tr"))
  await waitForView(() => expect(loadMore()).toBeDefined())
  expect(rows().length).toBeLessThan(audit.length)

  while (loadMore()) {
    const previousCount = rows().length
    await act(() => loadMore()!.click())
    await waitForView(() => expect(rows().length).toBeGreaterThan(previousCount))
    expect(rows().length).toBeLessThanOrEqual(audit.length)
  }

  const displayed = rows().map((row) => [
    row.querySelector("time")?.dateTime,
    ...Array.from(row.cells, (cell) => cell.textContent).slice(1),
  ])
  expect(displayed).toEqual(
    audit.map(({ at, actorLabel, action, target, reason, ip }) => [
      at,
      actorLabel,
      action,
      target ?? "—",
      reason ?? "—",
      ip ?? "—",
    ])
  )
})

it("vuelve al resumen desde una ruta desconocida", async () => {
  await openApp("/ruta-inexistente")
  await waitForView(() =>
    expect(host.textContent).toContain("Página no encontrada")
  )
  const back = Array.from(host.querySelectorAll("a")).find(
    (link) => link.textContent === "Volver al resumen"
  )
  expect(back?.getAttribute("href")).toBe("/")
  await act(() => back!.click())

  await waitForView(() =>
    expect(host.querySelector("h1")?.textContent).toBe("Resumen")
  )
  expect(window.location.pathname).toBe("/")
})
