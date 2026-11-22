// @vitest-environment happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { onReauthRequested } from "@/lib/query"
import { refreshSession } from "@/lib/session"
import { RevealDialog } from "./reveal-dialog"

vi.mock("@/lib/session", () => ({ refreshSession: vi.fn() }))

const request = vi.fn<typeof fetch>()
const requestId = "req_1"
const reason = "Revisar el horario informado"
let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", request)
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
  await act(() => root.render(<RevealDialog requestId={requestId} />))
  await click("Revelar payload")
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  request.mockReset()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function button(label: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === label
  )
  if (!match) throw new Error(`Falta el botón ${label}`)
  return match
}

async function click(label: string) {
  await act(() => button(label).click())
}

async function enterReason(value: string) {
  const field = document.querySelector("textarea")!
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!
    setter.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

it("exige un motivo, espera la revelación auditada y descarta los datos al cerrar", async () => {
  await enterReason("    breve    ")
  expect(button("Revelar").disabled).toBe(true)
  await click("Revelar")
  expect(request).not.toHaveBeenCalled()

  let respond!: (response: Response) => void
  request.mockReturnValueOnce(
    new Promise((resolve) => {
      respond = resolve
    })
  )
  await enterReason(`  ${reason}  `)
  await click("Revelar")
  expect(request).toHaveBeenCalledTimes(1)
  const [path, init] = request.mock.calls[0]!
  expect(path).toBe(`/api/admin/requests/${requestId}/reveal`)
  expect(init?.method).toBe("POST")
  expect(JSON.parse(String(init?.body))).toEqual({ reason })
  expect(button("Revelar").disabled).toBe(true)
  expect(button("Cancelar").disabled).toBe(true)

  const payload = {
    requestId,
    args: { day: "lunes" },
    purpose: "coordinar la reunión",
    result: null,
    auditId: "audit-42",
    revealedAt: "2026-05-01T12:00:00Z",
  }
  await act(() => respond(Response.json(payload)))
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain(payload.auditId)
  const values = Array.from(dialog.querySelectorAll("pre"), (block) =>
    JSON.parse(block.textContent!)
  )
  expect(values).toEqual([payload.args, payload.purpose, payload.result])

  await click("Cerrar y descartar")
  expect(dialog.isConnected).toBe(false)
  await click("Revelar payload")
  expect(document.body.textContent).not.toContain(payload.purpose)
  expect(document.querySelector("textarea")?.value).toBe("")
  expect(request).toHaveBeenCalledTimes(1)
})

it("descarta el motivo y pide reautenticación si la sesión ya no es fresca", async ({
  onTestFinished,
}) => {
  const reauth = vi.fn()
  onTestFinished(onReauthRequested(reauth))
  request.mockResolvedValueOnce(
    Response.json(
      { error: { code: "not_fresh", message: "Vuelve a entrar" } },
      { status: 403 }
    )
  )
  await enterReason(reason)
  await click("Revelar")
  expect(reauth).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click("Revelar payload")
  expect(document.querySelector("textarea")?.value).toBe("")
  expect(button("Revelar").disabled).toBe(true)
})

it("actualiza la sesión cuando la API responde 401", async () => {
  request.mockResolvedValueOnce(Response.json({}, { status: 401 }))
  await enterReason(reason)
  await click("Revelar")
  expect(refreshSession).toHaveBeenCalledOnce()
  expect(document.querySelector("pre")).toBeNull()
})

it.each([
  [429, "Límite de revelaciones alcanzado (10 por hora)."],
  [503, "No se pudo revelar el payload."],
] as const)(
  "informa el error %i y conserva el motivo para reintentar",
  async (status, message) => {
    const notify = vi.spyOn(toast, "error").mockReturnValue("toast-id")
    request.mockResolvedValueOnce(Response.json({}, { status }))
    await enterReason(reason)
    await click("Revelar")
    expect(notify.mock.calls[0]?.[0]).toBe(message)
    expect(document.querySelector("textarea")?.value).toBe(reason)
    expect(button("Revelar").disabled).toBe(false)
  }
)
