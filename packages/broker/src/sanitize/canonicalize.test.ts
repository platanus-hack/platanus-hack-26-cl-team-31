import { ToolName, fieldsOf } from "@team-31/protocol";
import { describe, expect, it } from "vitest";
import { BrokerError } from "../errors.js";
import { canonicalize, createCanonicalize } from "./canonicalize.js";
import { FIELD_SPECS } from "./fields.js";
import { ctxFor, stateOf } from "./test-helpers.js";
import type { SanitizeState } from "./types.js";

function run(tool: ToolName, value: unknown): SanitizeState {
  return canonicalize(stateOf(value), ctxFor(tool)) as SanitizeState;
}

describe("FIELD_SPECS", () => {
  it.each(ToolName.options)("covers exactly the fields of %s", (tool) => {
    expect(Object.keys(FIELD_SPECS[tool]).sort()).toEqual(fieldsOf(tool).sort());
  });
});

describe("canonicalize", () => {
  it("normalizes free text and reports what changed", () => {
    const out = run("question", { answer: "  Sí\u200B, nos vemos\u202E.  " });
    expect(out.value).toEqual({ answer: "Sí, nos vemos." });
    expect(out.flags).toEqual([{ stage: "canonicalize", code: "invisible_chars_removed", field: "answer" }]);
  });

  it("reports whitespace-only changes as text_normalized", () => {
    expect(run("question", { answer: " Sí " }).flags).toEqual([
      { stage: "canonicalize", code: "text_normalized", field: "answer" },
    ]);
  });

  it("enforces max lengths with truncation", () => {
    const out = run("profile", { displayName: "a".repeat(100), headline: "b ".repeat(200) });
    const value = out.value as { displayName: string; headline: string };
    expect(value.displayName).toHaveLength(80);
    expect(value.headline.length).toBeLessThanOrEqual(160);
    expect(out.flags.filter((flag) => flag.code === "truncated")).toHaveLength(2);
  });

  it("removes optional fields that become empty", () => {
    const out = run("profile", { displayName: "Ana", headline: "\u200B \u2060" });
    expect(out.value).toEqual({ displayName: "Ana" });
    expect(out.flags.map((flag) => flag.code)).toContain("empty_optional_removed");
  });

  it("rejects required text that becomes empty", () => {
    const call = () => run("question", { answer: "\u200B\u200B" });
    expect(call).toThrow(BrokerError);
    expect(call).toThrow(/vacía o inválida.*answer/);
  });

  it("canonicalizes slots and flags inconsistent availability", () => {
    const out = run("availability", { available: false, freeSlots: ["11:00-12:00", "09:00-10:00", "09:30-11:00"] });
    expect(out.value).toEqual({ available: false, freeSlots: ["09:00-12:00"] });
    expect(out.flags.map((flag) => flag.code)).toEqual(["slots_normalized", "availability_inconsistent"]);
  });

  it("drops reversed slots", () => {
    const out = run("availability", { available: true, freeSlots: ["12:00-11:00"] });
    expect(out.value).toEqual({ available: true, freeSlots: [] });
    expect(out.flags.map((flag) => flag.code)).toContain("slot_invalid_dropped");
  });

  it("is idempotent", () => {
    const first = run("question", { answer: " Jose\u0301 \n\n\n dijo\u00A0sí " });
    const second = run("question", first.value);
    expect(second.value).toEqual(first.value);
    expect(second.flags).toEqual([]);
  });

  it("fails closed when a field has no spec", () => {
    const stage = createCanonicalize({ ...FIELD_SPECS, question: {} });
    expect(() => stage(stateOf({ answer: "Sí" }), ctxFor("question"))).toThrow(
      expect.objectContaining({ code: "internal" }),
    );
  });

  it("supports date and datetime specs for future fields", () => {
    const stage = createCanonicalize({
      ...FIELD_SPECS,
      profile: { displayName: { kind: "date" }, headline: { kind: "datetime" } },
    });
    const out = stage(stateOf({ displayName: " 2026-11-21 ", headline: "2026-11-21T07:00-03:00" }), ctxFor("profile"));
    expect((out as SanitizeState).value).toEqual({ displayName: "2026-11-21", headline: "2026-11-21T10:00:00.000Z" });
    expect(() => stage(stateOf({ displayName: "ayer" }), ctxFor("profile"))).toThrow(BrokerError);
  });

  it("requires a parsed record", () => {
    expect(() => run("question", "Sí")).toThrow(expect.objectContaining({ code: "internal" }));
  });
});
