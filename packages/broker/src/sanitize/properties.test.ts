import { ToolResultSchemas, fieldsOf, type ToolName } from "@team-31/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BrokerError } from "../errors.js";
import { canonicalLine, canonicalText, normalizeSlots } from "./text.js";
import { containsHint } from "./text.js";
import { sanitizeReply } from "./pipeline.js";
import { createFakeRedactor } from "./redact.js";
import { SanitizeBlockedError, type SanitizeContext, type SanitizeReport } from "./types.js";

const RUNS = 300;

// Text biased towards the tricky parts of Unicode.
const tricky = fc.constantFrom(
  "\u200B", "\u200D", "\u202E", "\u2066", "\uFEFF", "\u00AD", "\u0301", "\u00A0", "\u3000", "\r\n", "\n", "\t",
  "\u{E0041}", "\uFE0F", "\uD800", "\u0000", "\u2028", "é", "е", "ｄ", "𝐝", "👨\u200D👩", "@", ".", " ",
);
const text = fc
  .array(fc.oneof(fc.string({ unit: "grapheme", maxLength: 6 }), tricky, fc.constantFrom("dentista", "Dr. Soto", "ok")), {
    maxLength: 40,
  })
  .map((parts) => parts.join(""));

const hhmm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const slot = fc.tuple(hhmm, hhmm).map(([a, b]) => `${a}-${b}`);

const extraKeys = fc.dictionary(
  fc.oneof(fc.string({ maxLength: 10 }), fc.constantFrom("note", "internalReason", "toString", "valueOf")),
  fc.anything(),
  { maxKeys: 5 },
);

function rawFor(tool: ToolName) {
  switch (tool) {
    case "profile":
      return fc.record({ displayName: text, headline: fc.option(text, { nil: undefined }) }, { requiredKeys: ["displayName"] });
    case "availability":
      return fc.record({ available: fc.boolean(), freeSlots: fc.option(fc.array(slot, { maxLength: 30 }), { nil: undefined }) }, {
        requiredKeys: ["available"],
      });
    case "question":
      return fc.record({ answer: text });
    case "interest_check":
      return fc.record({ matches: fc.boolean() });
    case "connect":
    case "vault_access":
    case "category_access":
      return fc.record({ accepted: fc.boolean() });
  }
}

const tools: ToolName[] = ["profile", "availability", "question", "interest_check", "connect", "vault_access", "category_access"];
const hints = ["dentista", "Dr. Soto"];
const required: Record<ToolName, string[]> = {
  profile: ["displayName"], availability: ["available"], question: ["answer"],
  interest_check: ["matches"], connect: ["accepted"],
  vault_access: ["accepted"],
  category_access: ["accepted"],
};

const scenario = fc
  .constantFrom(...tools)
  .chain((tool) =>
    fc.record({
      tool: fc.constant(tool),
      raw: fc.tuple(rawFor(tool), extraKeys).map(([known, extra]) => ({ ...extra, ...known })),
      // Required fields are always allowed (the policy rejects otherwise, covered in policy.test.ts).
      allowedFields: fc
        .subarray([...fieldsOf(tool).filter((field) => !required[tool].includes(field)), "secret", "note"])
        .map((optional) => [...required[tool], ...optional]),
      redact: fc.boolean(),
    }),
  );

function ctxOf(s: { tool: ToolName; allowedFields: string[]; redact: boolean }): SanitizeContext {
  return {
    tool: s.tool,
    allowedFields: s.allowedFields,
    privateHints: hints,
    canaries: ["CANARY-42"],
    ...(s.redact ? { redactor: createFakeRedactor() } : {}),
  };
}

async function attempt(raw: unknown, ctx: SanitizeContext): Promise<SanitizeReport | undefined> {
  try {
    return await sanitizeReply(raw, ctx);
  } catch (error) {
    // Rejections are allowed, but only as typed broker errors (never a crash or a leak in the message).
    expect(error).toBeInstanceOf(BrokerError);
    if (error instanceof SanitizeBlockedError) expect(error.message).not.toMatch(/dentista|soto/i);
    return undefined;
  }
}

describe("sanitizeReply invariants", () => {
  it("output validates its schema, stays inside allowedFields, never leaks hints, and is idempotent", async () => {
    let delivered = 0;
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const ctx = ctxOf(s);
        const report = await attempt(s.raw, ctx);
        if (!report) return;
        delivered += 1;

        expect(ToolResultSchemas[s.tool].safeParse(report.result).success).toBe(true);
        for (const field of Object.keys(report.result)) expect(s.allowedFields).toContain(field);
        expect(report.delivered).toEqual(Object.keys(report.result).sort((a, b) => fieldsOf(s.tool).indexOf(a) - fieldsOf(s.tool).indexOf(b)));
        for (const field of report.dropped) expect(report.delivered).not.toContain(field);

        for (const value of Object.values(report.result)) {
          if (typeof value !== "string") continue;
          for (const hint of hints) expect(containsHint(value, hint)).toBe(false);
          expect(value).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/);
          expect(value).toBe(value.normalize("NFC"));
        }

        const again = await sanitizeReply(report.result, ctx);
        expect(again.result).toEqual(report.result);
      }),
      { numRuns: RUNS },
    );
    // Guard against a vacuous property: most generated replies must actually make it through.
    expect(delivered).toBeGreaterThan(RUNS / 2);
  });

  it("never throws anything but BrokerError on arbitrary input", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...tools), fc.anything({ withNullPrototype: true, withObjectString: true }), async (tool, raw) => {
        await attempt(raw, { tool, allowedFields: fieldsOf(tool), privateHints: hints });
      }),
      { numRuns: RUNS },
    );
  });
});

describe("text helper invariants", () => {
  it("canonicalLine/canonicalText are idempotent and bounded", () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 1, max: 200 }), (input, max) => {
        const line = canonicalLine(input, max).text;
        expect(line.length).toBeLessThanOrEqual(max);
        expect(canonicalLine(line, max).text).toBe(line);
        expect(line).not.toMatch(/\n/);
        const multi = canonicalText(input, max).text;
        expect(multi.length).toBeLessThanOrEqual(max);
        expect(canonicalText(multi, max).text).toBe(multi);
      }),
      { numRuns: RUNS * 3 },
    );
  });

  it("normalizeSlots output is sorted, disjoint, non-empty ranges and idempotent", () => {
    fc.assert(
      fc.property(fc.array(slot, { maxLength: 40 }), (slots) => {
        const out = normalizeSlots(slots).slots;
        for (let i = 0; i < out.length; i += 1) {
          const [start, end] = out[i]!.split("-") as [string, string];
          expect(start < end).toBe(true);
          if (i > 0) expect(out[i - 1]!.split("-")[1]! < start).toBe(true);
        }
        expect(normalizeSlots(out)).toEqual({ slots: out, invalid: 0, changed: false });
      }),
      { numRuns: RUNS * 3 },
    );
  });
});
