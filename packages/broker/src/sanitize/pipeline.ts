import { ToolResultSchemas, fieldsOf, type ToolResult } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import { canonicalize } from "./canonicalize.js";
import { leakGuard } from "./leak-guard.js";
import { parse } from "./parse.js";
import { policy } from "./policy.js";
import { redact } from "./redact.js";
import type { SanitizeContext, SanitizeFlag, SanitizeReport, SanitizeState, Stage } from "./types.js";

/**
 * parse → canonicalize → policy → redact → (parse → canonicalize → policy) → leak-guard.
 * The redactor may be an LLM, so its output is treated as untrusted and fully re-validated; the last
 * word always belongs to deterministic stages.
 */
export const defaultStages: readonly Stage[] = [
  parse,
  canonicalize,
  policy,
  redact,
  parse,
  canonicalize,
  policy,
  leakGuard,
];

export async function runStages(
  stages: readonly Stage[],
  state: SanitizeState,
  ctx: SanitizeContext,
): Promise<SanitizeState> {
  let current = state;
  for (const stage of stages) current = await stage(current, ctx);
  return current;
}

function dedupeFlags(flags: readonly SanitizeFlag[]): SanitizeFlag[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.stage}\u0000${flag.code}\u0000${flag.field ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Final assertion + summary compatible with `ReplyReceipt`. */
export function toReport(state: SanitizeState, ctx: SanitizeContext): SanitizeReport {
  const parsed = ToolResultSchemas[ctx.tool].safeParse(state.value);
  if (!parsed.success) throw new BrokerError("internal", "La respuesta saneada no cumple el formato esperado.");
  const result = parsed.data as ToolResult & Record<string, unknown>;

  const outside = Object.keys(result).filter((field) => !ctx.allowedFields.includes(field));
  if (outside.length > 0) throw new BrokerError("internal", "La respuesta saneada contiene campos no autorizados.");

  const order = fieldsOf(ctx.tool);
  const delivered = order.filter((field) => Object.hasOwn(result, field));
  const dropped = [...new Set(state.dropped)].filter((field) => !delivered.includes(field)).sort();
  return { result, delivered, dropped, flags: dedupeFlags(state.flags) };
}

/** Turns a raw agent reply into a safe, typed, canonical result for the requester. */
export async function sanitizeReply(
  raw: unknown,
  ctx: SanitizeContext,
  stages: readonly Stage[] = defaultStages,
): Promise<SanitizeReport> {
  const state = await runStages(stages, { value: raw, dropped: [], flags: [] }, ctx);
  return toReport(state, ctx);
}
