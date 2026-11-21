// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { CopyButton, CopyId } from "./copy-id"
import { TooltipProvider } from "./ui/tooltip"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("muestra el ID completo en el tooltip, lo copia y abre su detalle desde el enlace", async () => {
  const id = "solicitud-123456789"
  const path = `/solicitudes/${id}`
  const onRowClick = vi.fn()
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  const success = vi.spyOn(toast, "success")

  await act(() =>
    root.render(
      <MemoryRouter>
        <TooltipProvider>
          <Routes>
            <Route
              path="/"
              element={
                <div onClick={onRowClick}>
                  <CopyId value={id} to={path} max={10} />
                </div>
              }
            />
            <Route path={path} element={<h1>Detalle de solicitud</h1>} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>
    )
  )

  const link = host.querySelector("a")!
  expect(link.textContent).toBe("solicitud…")
  await act(() => link.focus())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(id)

  const button = host.querySelector("button")!
  expect(button.getAttribute("aria-label")).toBe(`Copiar ${id}`)
  await act(() => button.click())
  expect(write).toHaveBeenCalledExactlyOnceWith(id)
  expect(success).toHaveBeenCalledExactlyOnceWith("Copiado", {
    description: id,
  })
  expect(onRowClick).not.toHaveBeenCalled()

  await act(() => link.click())
  expect(host.querySelector("h1")?.textContent).toBe("Detalle de solicitud")
  expect(onRowClick).not.toHaveBeenCalled()
})

it("muestra un ID sin enlace ni abreviatura cuando cabe justo en el límite", async () => {
  await act(() => root.render(<CopyId value="span-1" max={6} />))
  expect(host.textContent).toBe("span-1")
  expect(host.querySelector("a")).toBeNull()
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Copiar span-1"
  )
})

it("avisa si se deniega la copia y muestra una confirmación temporal al reintentar", async () => {
  vi.useFakeTimers()
  const value =
    "Una referencia de prueba que supera los cuarenta y ocho caracteres."
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("Permiso denegado"))
    .mockResolvedValueOnce()
  const error = vi.spyOn(toast, "error")
  const success = vi.spyOn(toast, "success")
  await act(() => root.render(<CopyButton value={value} />))
  const button = host.querySelector("button")!
  expect(button.getAttribute("aria-label")).toBe("Copiar")

  await act(() => button.click())
  expect(error).toHaveBeenCalledExactlyOnceWith(
    "No se pudo copiar al portapapeles."
  )
  expect(success).not.toHaveBeenCalled()
  expect(button.querySelector(".lucide-copy")).not.toBeNull()

  await act(() => button.click())
  expect(write.mock.calls).toEqual([[value], [value]])
  expect(success).toHaveBeenCalledExactlyOnceWith("Copiado", {
    description: `${value.slice(0, 48)}…`,
  })
  expect(button.querySelector(".lucide-check")).not.toBeNull()
  await act(() => {
    vi.advanceTimersByTime(1_500)
  })
  expect(button.querySelector(".lucide-copy")).not.toBeNull()
})
