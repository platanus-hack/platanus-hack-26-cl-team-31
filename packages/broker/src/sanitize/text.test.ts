import { describe, expect, it } from "vitest";
import {
  canonicalDate,
  canonicalDateTime,
  canonicalLine,
  canonicalText,
  compactSkeleton,
  containsHint,
  normalizeSlots,
  stripInvisible,
  truncateGraphemes,
} from "./text.js";

const ZWSP = "\u200B";
const ZWJ = "\u200D";
const RLO = "\u202E";
const LRI = "\u2066";
const BOM = "\uFEFF";
const SOFT_HYPHEN = "\u00AD";
const TAG_A = String.fromCodePoint(0xe0061);
const VS16 = "\uFE0F";

describe("stripInvisible", () => {
  it.each([
    ["zero-width space", `se${ZWSP}cre${ZWSP}to`, "secreto"],
    ["bidi override", `${RLO}txt.exe`, "txt.exe"],
    ["bidi isolate", `${LRI}abc`, "abc"],
    ["BOM", `${BOM}hola`, "hola"],
    ["soft hyphen", `den${SOFT_HYPHEN}tista`, "dentista"],
    ["unicode tags (ASCII smuggling)", `ok${TAG_A}${TAG_A}`, "ok"],
    ["C0/C1 controls", "a\u0000b\u0007c\u009Bd", "abcd"],
    ["lone surrogate", "a\uD800b", "ab"],
    ["variation selectors", `ok${VS16}`, "ok"],
  ])("removes %s", (_label, input, expected) => {
    const out = stripInvisible(input, false);
    expect(out.text).toBe(expected);
    expect(out.removedInvisible).toBe(true);
  });

  it("keeps newlines only when asked and normalizes CRLF/LS/PS", () => {
    expect(stripInvisible("a\r\nb\u2028c\u2029d\re", true).text).toBe("a\nb\nc\nd\ne");
    expect(stripInvisible("a\nb", false).text).toBe("a b");
  });

  it("does not flag plain text", () => {
    expect(stripInvisible("Hola, ¿cómo estás?", false).removedInvisible).toBe(false);
  });
});

describe("canonicalLine / canonicalText", () => {
  it("applies NFC so composed and decomposed forms are equal", () => {
    expect(canonicalLine("Jose\u0301", 80).text).toBe("José");
    expect(canonicalLine("José", 80).text).toBe("José");
  });

  it("collapses exotic spaces and trims", () => {
    expect(canonicalLine("\u00A0 Ana\u2003\u3000 María\t\n ", 80).text).toBe("Ana María");
  });

  it("keeps at most one blank line in multi-line text", () => {
    expect(canonicalText("  Sí.  \n\n\n\n  Nos vemos  \r\n", 1000).text).toBe("Sí.\n\nNos vemos");
  });

  it("truncates at a grapheme boundary", () => {
    const family = `👨${ZWJ}👩${ZWJ}👧`;
    const out = truncateGraphemes(`ab${family}`, 4);
    expect(out).toEqual({ text: "ab", truncated: true });
    expect(canonicalLine("x".repeat(100), 10)).toMatchObject({ text: "x".repeat(10), truncated: true });
  });

  it("is idempotent", () => {
    const input = ` ${RLO}Jose\u0301${ZWSP}  ${"y".repeat(200)} `;
    const once = canonicalLine(input, 50).text;
    expect(canonicalLine(once, 50).text).toBe(once);
    const text = canonicalText(`a\n\n\n b ${ZWSP}\r\n c`, 1000).text;
    expect(canonicalText(text, 1000).text).toBe(text);
  });
});

describe("normalizeSlots", () => {
  it("sorts, dedupes and merges overlapping and touching slots", () => {
    expect(normalizeSlots(["14:00-15:00", "09:00-10:00", "09:30-10:30", "10:30-11:00", "14:00-15:00"])).toEqual({
      slots: ["09:00-11:00", "14:00-15:00"],
      invalid: 0,
      changed: true,
    });
  });

  it("drops empty or reversed ranges", () => {
    expect(normalizeSlots(["10:00-10:00", "12:00-11:00", "08:00-09:00"])).toEqual({
      slots: ["08:00-09:00"],
      invalid: 2,
      changed: true,
    });
  });

  it("reports canonical input as unchanged", () => {
    expect(normalizeSlots(["08:00-09:00", "10:00-11:00"]).changed).toBe(false);
  });
});

describe("dates", () => {
  it.each([
    ["2026-02-28", "2026-02-28"],
    [" 2024-02-29 ", "2024-02-29"],
    ["2026-02-29", undefined],
    ["2026-13-01", undefined],
    ["26-1-1", undefined],
  ])("canonicalDate(%j) = %j", (input, expected) => {
    expect(canonicalDate(input)).toBe(expected);
  });

  it.each([
    ["2026-11-21T10:00:00Z", "2026-11-21T10:00:00.000Z"],
    ["2026-11-21T07:00-03:00", "2026-11-21T10:00:00.000Z"],
    ["2026-11-21 07:00:00.5+0000", "2026-11-21T07:00:00.500Z"],
    ["2026-11-21T10:00:00", undefined],
    ["2026-11-31T10:00:00Z", undefined],
    ["2026-11-21T25:00:00Z", undefined],
    ["mañana", undefined],
  ])("canonicalDateTime(%j) = %j", (input, expected) => {
    expect(canonicalDateTime(input)).toBe(expected);
  });
});

describe("skeleton matching", () => {
  it("folds homoglyphs, leetspeak, accents, width and separators", () => {
    const hint = "Dentista";
    expect(containsHint("Tengo d3nt1sta", hint)).toBe(true);
    expect(containsHint("Tengo dеntistа", hint)).toBe(true); // Cyrillic е / а
    expect(containsHint("Tengo ｄｅｎｔｉｓｔａ", hint)).toBe(true); // fullwidth
    expect(containsHint("Tengo d.e.n.t.i.s.t.a", hint)).toBe(true);
    expect(containsHint("Tengo DÉNTISTA", hint)).toBe(true);
    expect(containsHint("Tengo 𝐝𝐞𝐧𝐭𝐢𝐬𝐭𝐚", hint)).toBe(true); // math bold
    expect(containsHint("Tengo una reunión", hint)).toBe(false);
  });

  it("matches short hints only as whole tokens", () => {
    expect(containsHint("Me gusta la banana", "Ana")).toBe(false);
    expect(containsHint("Estoy con Ana hoy", "Ana")).toBe(true);
  });

  it("produces stable compact skeletons", () => {
    expect(compactSkeleton("Dr. Soto")).toBe(compactSkeleton("dr soto"));
  });
});
