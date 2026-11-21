// Corredor red team / blue team: cada ataque corre contra un broker real en memoria y su
// observación se compara con el veredicto esperado (contained o known_gap documentado).
import { describe, expect, it } from "vitest";
import { cases } from "./cases.js";
import { createHarness } from "./world.js";

describe("red team / blue team del broker", () => {
  for (const testCase of cases) {
    it(`${testCase.expected === "known_gap" ? "[GAP CONOCIDO] " : ""}${testCase.id}`, async () => {
      const harness = await createHarness();
      try {
        const observation = await testCase.run(harness);
        const ok = testCase.expected === "contained" ? observation.contained : !observation.contained;
        expect(ok, [
          `${testCase.id}`,
          `veredicto esperado: ${testCase.expected}`,
          `observado: ${observation.contained ? "contained" : "leaked"}`,
          observation.detail ?? "",
          testCase.note ?? "",
        ].filter(Boolean).join("\n")).toBe(true);
      } finally {
        await harness.close();
      }
    });
  }

  it("reporta la matriz de guardrail x veredicto", () => {
    const rows = new Map<string, { contained: number; gaps: number }>();
    for (const testCase of cases) {
      const row = rows.get(testCase.guardrail) ?? { contained: 0, gaps: 0 };
      if (testCase.expected === "known_gap") row.gaps += 1;
      else row.contained += 1;
      rows.set(testCase.guardrail, row);
    }
    for (const [guardrail, row] of rows) {
      const gaps = row.gaps > 0 ? ` · ${row.gaps} gap(s) documentado(s)` : "";
      console.log(`  ${guardrail}: ${row.contained} caso(s) contenido(s)${gaps}`);
    }
    expect(cases.length).toBeGreaterThan(10);
  });
});
