// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WindowProvider, useTimeWindow } from "./window"

function WindowControl() {
  const { window, setWindow } = useTimeWindow()
  return <button onClick={() => setWindow("7d")}>{window}</button>
}

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
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function openWindowControl() {
  await act(() =>
    root.render(
      <WindowProvider>
        <WindowControl />
      </WindowProvider>
    )
  )
  return host.querySelector("button")!
}

it("recupera la ventana elegida al volver a abrir el panel", async () => {
  const control = await openWindowControl()
  await act(() => control.click())
  await act(() => root.render(null))

  const reopened = await openWindowControl()
  expect(reopened.textContent).toBe("7d")
})

it("usa una hora si la preferencia guardada es inválida", async () => {
  localStorage.setItem("sideband-admin-window", "ayer")
  const control = await openWindowControl()
  expect(control.textContent).toBe("1h")
})

it("permite cambiar de ventana en memoria si el almacenamiento está bloqueado", async () => {
  const blocked = () => {
    throw new DOMException("Acceso denegado", "SecurityError")
  }
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked })
  const control = await openWindowControl()
  expect(control.textContent).toBe("1h")
  await act(() => control.click())
  expect(control.textContent).toBe("7d")
})
