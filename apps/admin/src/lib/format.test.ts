import { describe, expect, it } from "vitest"

import { formatDuration } from "./format"

describe("formatDuration", () => {
  it("distingue la duración ausente de cero", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(undefined)).toBe("—")
    expect(formatDuration(0)).toBe("<1 ms")
  })

  it.each([
    [4.7, "5 ms"],
    [1_230, "1,23 s"],
    [12_340, "12,3 s"],
    [60_000, "1 min"],
    [119_499, "1 min 59 s"],
    [119_500, "2 min"],
    [120_500, "2 min 1 s"],
  ] as const)("muestra %s ms como %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
