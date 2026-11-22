import { describe, expect, it } from "vitest"
import { pointOnCurve, type FlowActor } from "@team-31/agent-flow"
import { agentBrand, brokerSize, placeStation } from "./presentation"

describe("mapa de conversaciones", () => {
  it.each([320, 390, 579, 580, 900, 1600])(
    "mantiene libres los recorridos a %i px",
    (width) => {
      const max = width < 580 ? 4 : 6
      for (let n = 1; n <= max; n++) {
        const stations = Array.from({ length: n }, (_, i) =>
          placeStation(i, n, width, 345)
        )
        for (const { curve } of stations) {
          const halfExtent =
            width < 580 ? brokerSize.height / 2 : brokerSize.width / 2
          const portOffset =
            width < 580 ? curve.end.y - 345 / 2 : curve.end.x - width / 2
          expect(Math.abs(portOffset)).toBeCloseTo(halfExtent)
          for (let t = 0; t <= 1; t += 0.02) {
            const p = pointOnCurve(curve, t)
            expect(
              stations.some(
                (s) =>
                  Math.abs(p.x - s.x) < s.cardWidth / 2 - 0.01 &&
                  Math.abs(p.y - s.y) < s.cardHeight / 2 - 0.01
              )
            ).toBe(false)
          }
        }
      }
    }
  )

  it("identifica un tipo de aviso específico y mantiene los transportes genéricos sin marca", () => {
    const actor: FlowActor = {
      id: "a",
      role: "agent",
      label: "Agente",
      owner: { key: "ana", label: "Ana" },
    }
    expect(agentBrand({ ...actor, channel: "Grok Bot" }).logo).toBe("grok")
    expect(agentBrand({ ...actor, channel: "MCP" }).logo).toBeUndefined()
    expect(
      agentBrand({ ...actor, channel: "MCP", label: "Claude Code" }).logo
    ).toBe("claude")
  })
})
