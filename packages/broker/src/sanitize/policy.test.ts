import { describe, expect, it } from "vitest";
import { BrokerError } from "../errors.js";
import { filterResult } from "../policy/index.js";
import { policy } from "./policy.js";
import { ctxFor, stateOf } from "./test-helpers.js";
import type { SanitizeState } from "./types.js";

describe("policy stage", () => {
  it("delegates to filterResult and records dropped fields", () => {
    const value = { available: true, freeSlots: ["09:00-10:00"] };
    const out = policy(stateOf(value), ctxFor("availability", { allowedFields: ["available"] })) as SanitizeState;
    expect(out.value).toEqual(filterResult("availability", value, ["available"]).result);
    expect(out.value).toEqual({ available: true });
    expect(out.dropped).toEqual(["freeSlots"]);
    expect(out.flags).toEqual([{ stage: "policy", code: "policy_field_dropped", field: "freeSlots" }]);
  });

  it("keeps earlier dropped fields and flags", () => {
    const start: SanitizeState = {
      value: { answer: "Sí" },
      dropped: ["internalReason"],
      flags: [{ stage: "parse", code: "unknown_field_dropped", field: "internalReason" }],
    };
    const out = policy(start, ctxFor("question")) as SanitizeState;
    expect(out.dropped).toEqual(["internalReason"]);
    expect(out.flags).toHaveLength(1);
  });

  it("propagates the policy error when a required field is not allowed", () => {
    expect(() => policy(stateOf({ answer: "Sí" }), ctxFor("question", { allowedFields: [] }))).toThrow(BrokerError);
  });

  it("ignores allowed fields that are not part of the schema", () => {
    const out = policy(stateOf({ answer: "Sí" }), ctxFor("question", { allowedFields: ["answer", "secret"] }));
    expect((out as SanitizeState).value).toEqual({ answer: "Sí" });
  });
});
