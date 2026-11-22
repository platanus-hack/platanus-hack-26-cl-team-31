// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, onTestFinished, vi } from "vitest"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

it.each([
  [undefined, "ArrowRight"],
  ["vertical", "ArrowDown"],
] as const)(
  "activa el siguiente panel con la orientación %s y la tecla %s",
  async (orientation, key) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.useFakeTimers()
    const host = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host)
    onTestFinished(async () => {
      await act(() => root.unmount())
      host.remove()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    await act(() =>
      root.render(
        <Tabs defaultValue="timeline" orientation={orientation}>
          <TabsList aria-label="Solicitud">
            <TabsTrigger value="timeline">Línea de tiempo</TabsTrigger>
            <TabsTrigger value="wakes">Avisos</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline">Eventos de la solicitud</TabsContent>
          <TabsContent value="wakes">Intentos de entrega</TabsContent>
        </Tabs>
      )
    )

    const activePanel = () =>
      host.querySelector('[role="tabpanel"]:not([hidden])')
    expect(activePanel()?.textContent).toBe("Eventos de la solicitud")
    const first = host.querySelector<HTMLButtonElement>('[role="tab"]')!
    await act(async () => {
      first.focus()
      first.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
      await vi.runOnlyPendingTimersAsync()
    })
    expect(activePanel()?.textContent).toBe("Intentos de entrega")
    expect(
      host.querySelector('[role="tablist"]')?.getAttribute("aria-orientation")
    ).toBe(orientation ?? "horizontal")
  }
)
