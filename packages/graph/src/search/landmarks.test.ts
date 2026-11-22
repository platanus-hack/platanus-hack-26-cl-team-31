import { expect, it } from "vitest";
import { MemoryGraphIndex } from "../memory.js";
import { LandmarkTable } from "./landmarks.js";

it("el potencial base entre extremos suma los pesos base aunque el tema intermedio tenga penalización", () => {
  const index = new MemoryGraphIndex([
    { op: "upsertEdge", a: "person:ana", b: "topic:ajedrez", kind: "interested_in", base: 2 },
    { op: "upsertEdge", a: "person:bob", b: "topic:ajedrez", kind: "interested_in", base: 3 },
  ]);
  const table = LandmarkTable.build(index, 1, "base", index.growVersion);

  expect(table.potentialTo("person:bob")("person:ana")).toBe(5);
});
