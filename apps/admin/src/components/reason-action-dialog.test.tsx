// @vitest-environment happy-dom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ReasonActionDialog } from "./reason-action-dialog"

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
})

function ExpireDialog({
  onConfirm,
}: {
  onConfirm: (reason: string) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  return (
    <ReasonActionDialog
      open={open}
      onOpenChange={setOpen}
      title="Expirar solicitud"
      description="La solicitud se cerrará."
      confirmLabel="Expirar"
      destructive
      onConfirm={onConfirm}
      successMessage="Solicitud expirada"
    />
  )
}

async function openDialog(onConfirm: (reason: string) => Promise<void>) {
  await act(() => root.render(<ExpireDialog onConfirm={onConfirm} />))
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
  const buttons = Array.from(dialog.querySelectorAll("button"))
  return {
    dialog,
    cancel: buttons.find((button) => button.textContent === "Cancelar")!,
    confirm: buttons.find((button) => button.textContent === "Expirar")!,
    reason: dialog.querySelector("textarea")!,
  }
}

it("anuncia la acción y sus consecuencias y permite cancelar sin ejecutarla", async () => {
  const onConfirm = vi.fn()
  const { dialog, cancel } = await openDialog(onConfirm)
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!)
  const description = document.getElementById(
    dialog.getAttribute("aria-describedby")!
  )
  expect(title?.textContent).toBe("Expirar solicitud")
  expect(description?.textContent).toBe("La solicitud se cerrará.")
  expect(document.activeElement).toBe(cancel)

  await act(() => cancel.click())
  expect(dialog.isConnected).toBe(false)
  expect(onConfirm).not.toHaveBeenCalled()
})

it("exige un motivo y mantiene la confirmación abierta hasta completar la acción", async () => {
  let complete!: () => void
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  const onConfirm = vi.fn((_reason: string) => pending)
  const { dialog, cancel, confirm, reason } = await openDialog(onConfirm)
  expect(confirm.disabled).toBe(true)

  await act(() => {
    // Simula escritura del usuario sin actualizar el rastreador interno de React.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!
    setter.call(reason, "  Solicitud duplicada  ")
    reason.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(confirm.disabled).toBe(false)
  await act(() => confirm.click())
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Solicitud duplicada")
  expect(dialog.isConnected).toBe(true)
  expect(confirm.disabled).toBe(true)
  expect(cancel.disabled).toBe(true)

  await act(async () => complete())
  expect(dialog.isConnected).toBe(false)
})
