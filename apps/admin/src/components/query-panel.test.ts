import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { QueryPanel } from "./page"

it("shows retry on failure and preserves rows only when the query has data", () => {
  function render(isError: boolean, data: string[] | undefined) {
    const query = { isError, data, error: new Error("unavailable"), refetch: vi.fn() }
    return renderToStaticMarkup(createElement(QueryPanel, { query, children: data?.join(", ") || "Sin registros" }))
  }
  expect(render(true, undefined)).toContain("Reintentar")
  expect(render(true, undefined)).not.toContain("Sin registros")
  expect(render(false, [])).toContain("Sin registros")
  const cached = render(true, ["Ana"])
  expect(cached).toContain("Ana")
  expect(cached).toContain("Reintentar")
})
