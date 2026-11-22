import { expect, it } from "vitest"
import { checkReadOnlySql } from "./sql-guard.js"

it("acepta un punto y coma dentro de un literal delimitado por $nota$", () => {
  const sql = "SELECT $nota$turno mañana; turno tarde$nota$ AS horario"
  expect(checkReadOnlySql(sql)).toBe(sql)
})
