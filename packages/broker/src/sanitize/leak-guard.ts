import { FIELD_SPECS, isFreeText, isOptionalField } from "./fields.js";
import { compactSkeleton, containsHint, containsTokenRun, skeletonTokens } from "./text.js";
import {
  SanitizeBlockedError,
  addDropped,
  addFlags,
  asRecord,
  limitsOf,
  type ContactAllowance,
  type FlagCode,
  type SanitizeContext,
  type SanitizeFlag,
  type SyncStage,
} from "./types.js";

// --- Contact detectors (heuristic, run on NFKC-lowercased text) ------------------------------

const EMAIL =
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}|[\p{L}\p{N}._%+-]+\s*[([{]\s*(?:at|arroba)\s*[)\]}]\s*[\p{L}\p{N}-]+(?:\s*(?:\.|[([{]\s*(?:dot|punto)\s*[)\]}])\s*[\p{L}\p{N}-]+)+/gu;

const URL =
  /\b(?:https?|hxxps?|ftp):\/\/\S+|\bwww\.\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|net|org|io|app|dev|cl|ai|co|me|ly|gg|xyz|info|biz|link|site|online|ru|cn|to|sh|so|us|es|ar|mx|pe|br|uk|de)\b(?:\/\S*)?/gu;

// Dates, times and year ranges look like digit runs; remove them before searching for phones.
const NOT_PHONES = /\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}\b|\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g;
const PHONE = /\+?\d(?:[\s().-]{0,2}\d){7,}/g;

const INJECTION_MARKERS: readonly RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|messages|rules)/,
  /\bignora\s+(?:todas\s+)?(?:las\s+)?instrucciones\s+(?:anteriores|previas)/,
  /\bolv[ií]date\s+de\s+(?:todo\s+lo\s+anterior|las\s+instrucciones\s+(?:anteriores|previas))\b/,
  /\b(?:system|developer)\s+(?:prompt|message|instructions)\b/,
  /\b(?:prompt|instrucciones|mensaje)\s+(?:del\s+)?sistema\b/,
  /\byou\s+are\s+now\b/,
  /\bahora\s+eres\b/,
  /<\|[a-z_]+\|>|\[\/?inst\]|<\/?(?:system|assistant|user)>|^#{2,}\s*(?:system|instruction)/m,
];

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function allowed(value: string, allowance: ContactAllowance | undefined): boolean {
  if (allowance === true) return true;
  if (!allowance) return false;
  const compact = compactSkeleton(value);
  return allowance.some((entry) => compactSkeleton(entry) === compact);
}

function findContacts(text: string, ctx: SanitizeContext): FlagCode[] {
  const lower = normalized(text);
  const codes: FlagCode[] = [];
  const emails = lower.match(EMAIL) ?? [];
  if (emails.some((match) => !allowed(match, ctx.contacts?.emails))) codes.push("leak_email");

  // Emails contain domains; don't report them twice as URLs.
  const withoutEmails = lower.replace(EMAIL, " ");
  if (/(?:^|[^\p{L}\p{N}._%+-])@[\p{L}\p{N}_]+/u.test(withoutEmails.replace(URL, " "))) codes.push("leak_handle");
  const urls = withoutEmails.match(URL) ?? [];
  if (urls.some((match) => !allowed(match, ctx.contacts?.urls))) codes.push("leak_url");

  const phones = withoutEmails.replace(NOT_PHONES, " ").match(PHONE) ?? [];
  const realPhones = phones.filter((match) => match.replace(/\D/g, "").length >= 8);
  if (realPhones.some((match) => !allowed(match, ctx.contacts?.phones))) codes.push("leak_phone");
  return codes;
}

function echoesSender(text: string, ctx: SanitizeContext): boolean {
  const sender = ctx.senderMessage;
  if (!sender) return false;
  const minTokens = limitsOf(ctx).echoMinTokens;
  const output = skeletonTokens(text);
  for (const source of [sender.text, sender.purpose ?? ""]) {
    const tokens = skeletonTokens(source);
    if (tokens.length < minTokens) continue;
    for (let i = 0; i + minTokens <= tokens.length; i += 1) {
      if (containsTokenRun(output, tokens.slice(i, i + minTokens))) return true;
    }
  }
  return false;
}

/** Leak findings for one free-text value, without the matched content. */
export function inspectText(text: string, ctx: SanitizeContext): FlagCode[] {
  const codes: FlagCode[] = [];
  const compact = compactSkeleton(text);
  if ((ctx.canaries ?? []).some((canary) => {
    if (!canary.trim()) return false;
    const bytes = Buffer.from(canary);
    return compact.includes(compactSkeleton(canary)) ||
      text.includes(bytes.toString("base64url")) || text.includes(bytes.toString("base64").replace(/=+$/, ""));
  })) {
    codes.push("leak_canary");
  }
  if ((ctx.privateHints ?? []).some((hint) => containsHint(text, hint))) codes.push("leak_private_hint");
  codes.push(...findContacts(text, ctx));
  if (echoesSender(text, ctx)) codes.push("leak_sender_echo");
  const lower = normalized(text);
  if (INJECTION_MARKERS.some((marker) => marker.test(lower))) codes.push("leak_injection_marker");
  return codes;
}

/**
 * Deterministic last barrier. Canaries block the whole reply; any other finding drops the field when
 * it is optional, and blocks the reply when the field is required.
 */
export const leakGuard: SyncStage = (state, ctx) => {
  const value = asRecord(state.value, "leak-guard");
  const specs = FIELD_SPECS[ctx.tool];
  const out: Record<string, unknown> = {};
  const flags: SanitizeFlag[] = [];
  const dropped: string[] = [];
  let block = false;

  for (const [field, fieldValue] of Object.entries(value)) {
    if (!isFreeText(specs[field]) || typeof fieldValue !== "string") {
      out[field] = fieldValue;
      continue;
    }
    const codes = inspectText(fieldValue, ctx);
    if (codes.length === 0) {
      out[field] = fieldValue;
      continue;
    }
    flags.push(...codes.map((code): SanitizeFlag => ({ stage: "leak-guard", code, field })));
    if (codes.includes("leak_canary") || !isOptionalField(ctx.tool, field)) {
      block = true;
    } else {
      dropped.push(field);
      flags.push({ stage: "leak-guard", code: "leak_field_dropped", field });
    }
  }

  if (block) throw new SanitizeBlockedError([...state.flags, ...flags]);
  return addFlags(addDropped({ ...state, value: out }, dropped), flags);
};
