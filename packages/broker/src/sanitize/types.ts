import type { ToolName, ToolResult } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { Redactor } from "./redact.js";

export type StageName = "parse" | "canonicalize" | "policy" | "redact" | "leak-guard";

export type FlagCode =
  | "unknown_field_dropped"
  | "non_enumerable_field_dropped"
  | "invisible_chars_removed"
  | "text_normalized"
  | "truncated"
  | "empty_optional_removed"
  | "slot_invalid_dropped"
  | "slots_normalized"
  | "availability_inconsistent"
  | "policy_field_dropped"
  | "redacted"
  | "leak_private_hint"
  | "leak_canary"
  | "leak_email"
  | "leak_handle"
  | "leak_phone"
  | "leak_url"
  | "leak_sender_echo"
  | "leak_injection_marker"
  | "leak_field_dropped";

/** A flag never carries the matched content, only where and what kind of thing happened. */
export type SanitizeFlag = { stage: StageName; code: FlagCode; field?: string };

export type Limits = {
  /** Max own keys accepted on the raw reply object. */
  maxKeys: number;
  /** Max length of a key name (longer names are rejected). */
  maxKeyLength: number;
  /** Max raw length of any string before canonicalization (DoS guard). */
  maxRawStringLength: number;
  /** Max raw number of entries in an array field. */
  maxRawArrayLength: number;
  /** Min number of consecutive sender tokens echoed in the output to count as an echo. */
  echoMinTokens: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxKeys: 32,
  maxKeyLength: 64,
  maxRawStringLength: 8192,
  maxRawArrayLength: 200,
  echoMinTokens: 8,
};

/** `true` allows any value of that kind; a list allows only those exact values. */
export type ContactAllowance = boolean | readonly string[];

export type ContactPolicy = {
  emails?: ContactAllowance;
  phones?: ContactAllowance;
  urls?: ContactAllowance;
};

export type SanitizeContext = {
  tool: ToolName;
  /** Fields the owner's grant allows for this tool (as decided by the broker). */
  allowedFields: readonly string[];
  /** Owner guidance from the grant, forwarded to the redactor only. */
  guidance?: string;
  /** Owner-private strings that must never reach the requester (calendar titles, names...). */
  privateHints?: readonly string[];
  /** Planted tokens: any appearance blocks the whole reply. */
  canaries?: readonly string[];
  /** Untrusted message from the requester; the output must not echo it. */
  senderMessage?: { text: string; purpose?: string };
  contacts?: ContactPolicy;
  /** Defaults to the identity redactor (no-op). */
  redactor?: Redactor;
  /** What to do with keys that are not part of the tool schema. Default: drop and report. */
  unknownKeys?: "drop" | "reject";
  limits?: Partial<Limits>;
};

export type SanitizeState = {
  /** Raw input before `parse`; a validated plain object afterwards. */
  value: unknown;
  dropped: readonly string[];
  flags: readonly SanitizeFlag[];
};

export type Stage = (state: SanitizeState, ctx: SanitizeContext) => SanitizeState | Promise<SanitizeState>;

/** Deterministic stages are synchronous; any `SyncStage` is also a `Stage`. */
export type SyncStage = (state: SanitizeState, ctx: SanitizeContext) => SanitizeState;

/** Compatible with `ReplyReceipt.deliveredFields` / `droppedFields`. */
export type SanitizeReport = {
  result: ToolResult;
  delivered: string[];
  dropped: string[];
  flags: SanitizeFlag[];
};

export class SanitizeBlockedError extends BrokerError {
  constructor(public readonly flags: readonly SanitizeFlag[]) {
    super("forbidden", "La respuesta contiene información que no puede compartirse con el solicitante.");
    this.name = "SanitizeBlockedError";
  }
}

export function limitsOf(ctx: SanitizeContext): Limits {
  return { ...DEFAULT_LIMITS, ...ctx.limits };
}

export function invalid(message: string): BrokerError {
  return new BrokerError("invalid_input", message);
}

export function addFlags(state: SanitizeState, flags: readonly SanitizeFlag[]): SanitizeState {
  return flags.length === 0 ? state : { ...state, flags: [...state.flags, ...flags] };
}

export function addDropped(state: SanitizeState, fields: readonly string[]): SanitizeState {
  return fields.length === 0 ? state : { ...state, dropped: [...state.dropped, ...fields] };
}

/** Stages after `parse` require a plain record; anything else means the pipeline was misassembled. */
export function asRecord(value: unknown, stage: StageName): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BrokerError("internal", `La etapa ${stage} requiere un resultado ya validado por parse.`);
  }
  return value as Record<string, unknown>;
}
