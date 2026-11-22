import { expect, it } from "vitest";
import { formatSlot } from "./demo";

it("muestra los turnos de julio con el horario de invierno de Santiago", () => {
  expect(formatSlot("2026-07-11T22:00:00Z")).toBe("18:00");
});
