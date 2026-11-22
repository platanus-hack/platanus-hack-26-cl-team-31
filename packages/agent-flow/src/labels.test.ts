import { expect, it } from "vitest";
import { stepDetail } from "./labels.js";
import { BROKER } from "./model.js";

it("enumera los campos descartados aunque el saneamiento también registre hallazgos", () => {
  const detail = stepDetail({
    id: "sanitized-1",
    at: 0,
    step: "sanitized",
    status: "sanitized",
    from: BROKER,
    to: BROKER,
    meta: { fieldsDropped: ["freeSlots", "note"], flags: ["redact:redacted"] },
  });

  expect(detail).toBe("descarta freeSlots, note");
});
