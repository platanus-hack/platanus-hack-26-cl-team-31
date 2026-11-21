import { WakeNotice, WakeTarget, type WakeAttempt, type WakeResult, type Waker } from "@team-31/protocol";
import type { Telemetry } from "@team-31/telemetry";
import { grokbotPost } from "./adapters/grokbot.js";
import { mcpEventsPost, verifyMcpCallback } from "./adapters/mcp-events.js";
import { openclawPost } from "./adapters/openclaw.js";
import { standardWebhookPost } from "./adapters/standard-webhook.js";
import { createSafeFetch } from "./safe-fetch.js";
export { readWebhookBody } from "./read-webhook-body.js";

// "none" and "polling" have no adapter: nobody writes to them.
function adapterPost(target: Exclude<WakeTarget, { kind: "none" | "polling" }>, notice: WakeNotice) {
  switch (target.kind) {
    case "openclaw_hooks": return openclawPost(target, notice);
    case "grokbot_routine": return grokbotPost(target, notice);
    case "standard_webhook": return standardWebhookPost(target, notice);
    case "mcp_events": return mcpEventsPost(target, notice);
  }
}

export type WakerTelemetry = Pick<Telemetry, "span" | "emit">;

// Code without free text: the adapter detail is a fixed failure code, never a response body.
function resultCode(result: WakeResult): string {
  if (result.ok) return "ok";
  if (result.detail && /^[a-z_]{1,64}$/.test(result.detail)) return result.detail;
  return result.status === undefined ? "failed" : "http_error";
}

export function createWaker({ allowInsecure, telemetry }: {
  allowInsecure: boolean;
  // Injected by the service that owns the process; the package never creates its own.
  telemetry?: WakerTelemetry;
}): Waker {
  const safeFetch = createSafeFetch(allowInsecure && process.env.NODE_ENV !== "production");

  async function deliver(target: WakeTarget, notice: WakeNotice): Promise<WakeResult> {
    const start = performance.now();
    const finish = (result: Omit<WakeResult, "ms">): WakeResult => ({
      ...result,
      ms: performance.now() - start,
    });

    const parsedTarget = WakeTarget.safeParse(target);
    const parsedNotice = WakeNotice.safeParse({ event: notice.event, requestId: notice.requestId });
    if (!parsedTarget.success || !parsedNotice.success) {
      return finish({ ok: false, retryable: false, detail: "invalid_input" });
    }
    const validTarget = parsedTarget.data;
    if (validTarget.kind === "none") return finish({ ok: true, retryable: false });
    // A polling agent reads its own inbox: the dispatch succeeds without any request leaving.
    if (validTarget.kind === "polling") return finish({ ok: true, retryable: false, detail: "polling" });

    try {
      const result = await safeFetch(adapterPost(validTarget, parsedNotice.data));
      if ("failure" in result) {
        return finish({
          ok: false,
          retryable: result.failure === "timeout" || result.failure === "network_error",
          detail: result.failure,
        });
      }

      const { status } = result;
      const ok = validTarget.kind === "grokbot_routine" ? status === 200 : status >= 200 && status < 300;
      const retryable = status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
      return finish({ ok, status, retryable });
    } catch {
      return finish({ ok: false, retryable: false, detail: "invalid_input" });
    }
  }

  async function observed(target: WakeTarget, notice: WakeNotice, attempt?: WakeAttempt): Promise<WakeResult> {
    if (!telemetry) return deliver(target, notice);
    const parsed = WakeTarget.safeParse(target);
    const kind = parsed.success ? parsed.data.kind : "invalid";
    const ids = {
      requestId: typeof notice?.requestId === "string" ? notice.requestId : undefined,
      ...(attempt?.userId ? { userId: attempt.userId } : {}),
      ...(attempt?.agentId ? { agentId: attempt.agentId } : {}),
    };
    const result = await telemetry.span("wake.attempt", { ...ids, attrs: { kind, attempt: attempt?.attempt, queueWaitMs: attempt?.queueWaitMs } }, async (span) => {
      const result = await deliver(target, notice);
      span.set({ ok: result.ok, code: resultCode(result), ...(result.status === undefined ? {} : { httpStatus: result.status }) });
      if (!result.ok) span.setStatus("failed");
      return result;
    });
    // The worker stops retrying after a final or non-retryable failure.
    if (!result.ok && (!result.retryable || attempt?.final)) {
      telemetry.emit("wake.exhausted", { ...ids, attrs: { kind, attempts: attempt?.attempt ?? 1 } });
    }
    return result;
  }

  return {
    wake: observed,

    async verifyCallback(target) {
      const parsed = WakeTarget.safeParse(target);
      if (!parsed.success || parsed.data.kind !== "mcp_events") return { ok: false, reason: "challenge_failed" };
      return verifyMcpCallback(parsed.data, safeFetch);
    },
  };
}

export { verify as verifyWebhookSignature } from "./standard-webhooks.js";
