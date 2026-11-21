// Pure, deterministic text helpers shared by canonicalize and leak-guard.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Control, format, private-use, default-ignorable (zero-width, bidi, variation selectors,
// Hangul fillers, Unicode tags used for "ASCII smuggling") and noncharacters.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}]/gu;

const LINE_BREAKS = /\r\n|[\r\u0085\u2028\u2029\u000B\u000C]/g;
const SPACES = /[\t\p{Zs}]+/gu;

export type CleanResult = { text: string; removedInvisible: boolean };

/** Removes lone surrogates and invisible characters; keeps `\n` when `keepNewlines`. */
export function stripInvisible(input: string, keepNewlines: boolean): CleanResult {
  let removedInvisible = false;
  const noSurrogates = input.replace(LONE_SURROGATE, () => {
    removedInvisible = true;
    return "";
  });
  const text = noSurrogates.replace(LINE_BREAKS, "\n").replace(INVISIBLE, (char) => {
    if (char === "\n") return keepNewlines ? "\n" : " ";
    if (char === "\t") return " ";
    removedInvisible = true;
    return "";
  });
  return { text, removedInvisible };
}

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Cuts at a grapheme boundary so the result never ends in a broken character. */
export function truncateGraphemes(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return { text: out, truncated: true };
}

export type CanonicalText = { text: string; removedInvisible: boolean; changed: boolean; truncated: boolean };

/**
 * Single-line canonical form: invisible chars removed, NFC, every whitespace run → one space, trimmed,
 * truncated to `max` UTF-16 units at a grapheme boundary.
 */
export function canonicalLine(input: string, max: number): CanonicalText {
  const { text: stripped, removedInvisible } = stripInvisible(input, false);
  const collapsed = stripped.normalize("NFC").replace(/[\s\p{Zs}]+/gu, " ").trim();
  const { text, truncated } = truncateGraphemes(collapsed, max);
  const final = text.trim();
  return { text: final, removedInvisible, truncated, changed: final !== input };
}

/** Multi-line canonical form: like `canonicalLine` but keeps up to one blank line between paragraphs. */
export function canonicalText(input: string, max: number): CanonicalText {
  const { text: stripped, removedInvisible } = stripInvisible(input, true);
  const collapsed = stripped
    .normalize("NFC")
    .replace(SPACES, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const { text, truncated } = truncateGraphemes(collapsed, max);
  const final = text.trim();
  return { text: final, removedInvisible, truncated, changed: final !== input };
}

// --- Time slots -----------------------------------------------------------------------------

const SLOT = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])$/;

function minutes(h: string, m: string): number {
  return Number(h) * 60 + Number(m);
}

function hhmm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export type SlotResult = { slots: string[]; invalid: number; changed: boolean };

/** Parses `HH:MM-HH:MM`, drops empty/reversed ranges, sorts, and merges overlapping or touching ranges. */
export function normalizeSlots(input: readonly string[]): SlotResult {
  const ranges: Array<[number, number]> = [];
  let invalid = 0;
  for (const slot of input) {
    const match = SLOT.exec(slot);
    if (!match) {
      invalid += 1;
      continue;
    }
    const start = minutes(match[1]!, match[2]!);
    const end = minutes(match[3]!, match[4]!);
    if (end <= start) {
      invalid += 1;
      continue;
    }
    ranges.push([start, end]);
  }

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const slots = merged.map(([start, end]) => `${hhmm(start)}-${hhmm(end)}`);
  const changed = slots.length !== input.length || slots.some((slot, i) => slot !== input[i]);
  return { slots, invalid, changed };
}

// --- Dates ------------------------------------------------------------------------------------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** Returns `YYYY-MM-DD` for a real calendar date, or `undefined`. */
export function canonicalDate(input: string): string | undefined {
  const match = DATE.exec(input.trim());
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    return undefined;
  }
  return `${y}-${m}-${d}`;
}

/** Returns the UTC `toISOString()` form of an ISO-8601 datetime with explicit offset, or `undefined`. */
export function canonicalDateTime(input: string): string | undefined {
  const match = DATETIME.exec(input.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s = "00", fraction = "", zone] = match;
  if (!canonicalDate(`${y}-${mo}-${d}`)) return undefined;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return undefined;
  const offset = zone!.toUpperCase() === "Z" ? "Z" : zone!.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const millis = fraction.padEnd(3, "0").slice(0, 3);
  const ms = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${millis}${offset}`).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// --- Skeletons (leak matching) ----------------------------------------------------------------

// Common cross-script lookalikes and leetspeak, folded to a single Latin representative.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ӏ: "i", ԛ: "q", ԝ: "w", ɡ: "g", ı: "i", ɑ: "a",
  α: "a", β: "b", γ: "y", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  "0": "o", "1": "i", l: "i", "|": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", $: "s", "7": "t",
};

function foldChars(input: string): string {
  const base = input
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(INVISIBLE, "");
  let out = "";
  for (const char of base) out += CONFUSABLES[char] ?? char;
  return out.replace(/ß/g, "ss");
}

/** Lowercased, accent-free, homoglyph-folded tokens (non-alphanumerics act as separators). */
export function skeletonTokens(input: string): string[] {
  return foldChars(input).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Same as `skeletonTokens` joined without separators: defeats `d.e.n.t.i.s.t` and zero-width splits. */
export function compactSkeleton(input: string): string {
  return skeletonTokens(input).join("");
}

/** True when `needle` tokens appear contiguously inside `haystack` tokens. */
export function containsTokenRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Hints shorter than this (compact) only match as whole tokens, to avoid "ana" ⊂ "banana". */
export const MIN_COMPACT_HINT = 4;

export function containsHint(text: string, hint: string): boolean {
  const hintTokens = skeletonTokens(hint);
  const compactHint = hintTokens.join("");
  if (compactHint.length === 0) return false;
  if (compactHint.length < MIN_COMPACT_HINT) return containsTokenRun(skeletonTokens(text), hintTokens);
  return compactSkeleton(text).includes(compactHint);
}
