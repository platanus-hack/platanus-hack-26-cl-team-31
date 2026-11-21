import { describe, expect, it } from "vitest"
import { AgentFilters, RequestFilters } from "./contract.js"

describe("filtros booleanos de la API del admin", () => {
  it.each([
    ["false", false], ["0", false], [false, false],
    ["true", true], ["1", true], [true, true],
  ])("interpreta %j como %j", (value, expected) => {
    expect(RequestFilters.parse({ stuck: value }).stuck).toBe(expected)
    expect(AgentFilters.parse({ failing: value }).failing).toBe(expected)
  })

  it("conserva los filtros ausentes y rechaza valores ambiguos", () => {
    expect(RequestFilters.parse({}).stuck).toBeUndefined()
    expect(AgentFilters.parse({}).failing).toBeUndefined()
    expect(RequestFilters.safeParse({ stuck: "maybe" }).success).toBe(false)
    expect(AgentFilters.safeParse({ failing: "maybe" }).success).toBe(false)
  })
})
