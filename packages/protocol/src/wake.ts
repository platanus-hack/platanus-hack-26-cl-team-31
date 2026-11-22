import { z } from "zod";

export const WakeKind = z.enum([
  "none",
  "openclaw_hooks",
  "grokbot_routine",
  "standard_webhook",
  "mcp_events",
  "polling",
]);
export type WakeKind = z.infer<typeof WakeKind>;

const webhookSecret = z.string().startsWith("whsec_");

export const WakeTarget = z.discriminatedUnion("kind", [
  // The default: no push channel configured, or one that was removed. Not an opt-out from being a
  // recipient — an agent that keeps reading its inbox is promoted to "polling". The opt-out is revokeAgent.
  z.object({ kind: z.literal("none") }),
  // A CLI agent that reads its inbox on its own. Nobody writes to it: no URL, no secret.
  z.strictObject({ kind: z.literal("polling") }),
  z.object({
    kind: z.literal("openclaw_hooks"),
    baseUrl: z.url(),
    token: z.string().min(16),
    agentId: z.string().default("main"),
  }),
  z.object({ kind: z.literal("grokbot_routine"), url: z.url(), key: z.string().min(16) }),
  z.object({ kind: z.literal("standard_webhook"), url: z.url(), secret: webhookSecret }),
  z.object({
    kind: z.literal("mcp_events"),
    callbackUrl: z.url(),
    secret: webhookSecret,
    subscriptionId: z.string(),
    refreshBefore: z.string().nullable(),
  }),
]);
export type WakeTarget = z.infer<typeof WakeTarget>;

export const WAKE_EVENT = "sideband.request.created";

export const WakeNotice = z.strictObject({
  requestId: z.string(),
  event: z.literal(WAKE_EVENT),
});
export type WakeNotice = z.infer<typeof WakeNotice>;

export const WakeResult = z.object({
  ok: z.boolean(),
  status: z.number().optional(),
  retryable: z.boolean(),
  detail: z.string().optional(),
  ms: z.number(),
});
export type WakeResult = z.infer<typeof WakeResult>;

// Correlation metadata for observability. Never part of the notice sent to the agent.
export type WakeAttempt = {
  queueWaitMs?: number;
  // One-based attempt number of the wake job.
  attempt: number;
  // True when no retry follows this attempt if it fails.
  final: boolean;
  userId?: string;
  agentId?: string;
};

export const WakeVerificationReason = z.enum(["challenge_failed", "timeout", "https_required", "blocked_address"]);
export type WakeVerificationReason = z.infer<typeof WakeVerificationReason>;

export interface Waker {
  wake(target: WakeTarget, notice: WakeNotice, attempt?: WakeAttempt): Promise<WakeResult>;
  verifyCallback(target: Extract<WakeTarget, { kind: "mcp_events" }>): Promise<
    | { ok: true }
    | { ok: false; reason: WakeVerificationReason }
  >;
}
