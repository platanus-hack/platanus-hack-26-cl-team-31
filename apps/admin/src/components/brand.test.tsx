// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { BrandMark, GoogleIcon } from "./brand"

it.each([
  { className: undefined, size: "size-7" },
  { className: "size-9", size: "size-9" },
])("muestra la marca decorativa de Sideband con $size", ({ className, size }) => {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(<BrandMark className={className} />)

  const mark = host.querySelector("svg")?.closest('[aria-hidden="true"]')
  expect(mark?.classList.contains(size)).toBe(true)
  expect(mark?.classList.contains("bg-primary")).toBe(true)
  if (className) expect(mark?.classList.contains("size-7")).toBe(false)
})

it("oculta el icono de Google al lector de pantalla y conserva su posición en el botón", () => {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(<GoogleIcon data-icon="inline-start" />)

  const icon = host.querySelector("svg")
  expect(icon?.getAttribute("aria-hidden")).toBe("true")
  expect(icon?.getAttribute("data-icon")).toBe("inline-start")
})
