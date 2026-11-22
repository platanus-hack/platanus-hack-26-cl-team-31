import { describe, expect, it } from "vitest";
import { parseTraceparent } from "./context.js";

describe("parseTraceparent", () => {
  const traceId = "00000000000000000000000000000001";
  const parentSpanId = "0000000000000001";

  it("conserva ambos identificadores aunque tengan ceros iniciales y el muestreo esté desactivado", () => {
    expect(parseTraceparent(`00-${traceId}-${parentSpanId}-00`)).toEqual({ traceId, parentSpanId });
  });

  it.each([
    ["traceId", `00-${"0".repeat(32)}-${parentSpanId}-01`],
    ["parentSpanId", `00-${traceId}-${"0".repeat(16)}-01`],
  ])("descarta todo el contexto remoto si %s contiene solo ceros", (_field, header) => {
    expect(parseTraceparent(header)).toBeNull();
  });
});
