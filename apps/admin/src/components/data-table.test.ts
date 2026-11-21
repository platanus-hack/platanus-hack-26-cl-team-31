// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { DataTable } from "./data-table"

it("activates the row from its text or keyboard while nested controls keep their own actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div")
  const root = createRoot(host)
  const onRowClick = vi.fn()
  const onAction = vi.fn()
  const item = { id: "r1" }
  try {
    await act(() => root.render(createElement(DataTable<typeof item>, {
      data: [item], onRowClick,
      columns: [
        { accessorKey: "id", header: "Solicitud" },
        { id: "action", cell: () => createElement("button", { onClick: onAction }, "Copiar") },
      ],
    })))
    const row = host.querySelector("tbody tr")!
    const button = row.querySelector("button")!
    await act(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      button.click()
    })
    expect(onAction).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
    await act(() => {
      row.querySelector("td")!.click()
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(onRowClick).toHaveBeenCalledTimes(2)
    expect(onRowClick).toHaveBeenLastCalledWith(item)
  } finally {
    await act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
