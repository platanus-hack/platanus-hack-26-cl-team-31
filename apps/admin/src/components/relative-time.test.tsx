// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { formatAbsolute } from "@/lib/format"
import { RelativeTime } from "./relative-time"
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
  vi.unstubAllGlobals()
})

async function renderTime(value: string | null | undefined) {
  await act(() =>
    root.render(
      <TooltipProvider>
        <RelativeTime value={value} />
      </TooltipProvider>
    )
  )
}

it("actualiza la antigüedad con el reloj y conserva la fecha exacta para consultarla", async () => {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  })
  vi.setSystemTime(new Date("2026-05-12T12:00:00Z"))
  // El servidor registró el evento con 20 segundos de adelanto.
  const value = "2026-05-12T12:00:20Z"
  await renderTime(value)
  const time = host.querySelector("time")!
  expect(time.textContent).toBe("ahora")

  await act(() => vi.advanceTimersByTimeAsync(80_000))
  expect(time.textContent).toBe("hace 1 min")
  expect(time.dateTime).toBe(value)

  await act(() => {
    time.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })
    )
  })
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    formatAbsolute(value)
  )
})

it.each([null, undefined])(
  "muestra una raya cuando la fecha es %s",
  async (value) => {
    await renderTime(value)
    expect(host.textContent).toBe("—")
    expect(host.querySelector("time")).toBeNull()
  }
)
