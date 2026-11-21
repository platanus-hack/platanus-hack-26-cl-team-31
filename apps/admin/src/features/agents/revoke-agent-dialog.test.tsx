// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { userQuery } from "@/lib/queries"
import { agentRows } from "@/mocks/fixtures"
import { RevokeAgentDialog } from "./revoke-agent-dialog"

it("permite reintentar la revocación y actualiza ambas vistas solo al confirmarla la API", async ({
  onTestFinished,
}) => {
  const agent = agentRows().find((row) => !row.revokedAt)!
  const listKey = ["agents", { failing: false }]
  const userKey = userQuery(agent.userId).queryKey
  const client = new QueryClient()
  client.setQueryData(listKey, { items: [agent] })
  client.getQueryCache().build(client, { queryKey: userKey })

  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, auditId: "audit-1" }))
  vi.stubGlobal("fetch", request)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  onTestFinished(async () => {
    await act(() => root.unmount())
    client.clear()
    host.remove()
    vi.unstubAllGlobals()
  })

  const onClose = vi.fn()
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <RevokeAgentDialog agent={agent} onClose={onClose} />
      </QueryClientProvider>
    )
  )
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
  expect(dialog.textContent).toContain(agent.label)
  expect(dialog.textContent).toContain(agent.userId)
  const field = dialog.querySelector("textarea")!
  const confirm = Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === "Revocar"
  )!
  const reason = "El titular cambió de agente"
  await act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!
    setter.call(field, reason)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })

  await act(() => confirm.click())
  expect(request).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(false)
  expect(client.getQueryState(userKey)?.isInvalidated).toBe(false)

  await act(() => confirm.click())
  expect(request).toHaveBeenCalledTimes(2)
  for (const [path, init] of request.mock.calls) {
    expect(path).toBe(
      `/api/admin/agents/${agent.userId}/${agent.agentId}/revoke`
    )
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ reason })
  }
  expect(onClose).toHaveBeenCalledOnce()
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
  expect(client.getQueryState(userKey)?.isInvalidated).toBe(true)
})
