import { WakeNotice, WakeTarget, type WakeResult, type Waker } from "@team-31/protocol";
import { grokbotPost } from "./adapters/grokbot.js";
import { mcpEventsPost, verifyMcpCallback } from "./adapters/mcp-events.js";
import { openclawPost } from "./adapters/openclaw.js";
import { standardWebhookPost } from "./adapters/standard-webhook.js";
import { createSafeFetch } from "./safe-fetch.js";

function adapterPost(target: Exclude<WakeTarget, { kind: "none" }>, notice: WakeNotice) {
  switch (target.kind) {
    case "openclaw_hooks": return openclawPost(target, notice);
    case "grokbot_routine": return grokbotPost(target, notice);
    case "standard_webhook": return standardWebhookPost(target, notice);
    case "mcp_events": return mcpEventsPost(target, notice);
  }
}

export function createWaker({ allowInsecure }: { allowInsecure: boolean }): Waker {
  const safeFetch = createSafeFetch(allowInsecure && process.env.NODE_ENV !== "production");

  return {
    async wake(target, notice) {
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
    },

    async verifyCallback(target) {
      const parsed = WakeTarget.safeParse(target);
      if (!parsed.success || parsed.data.kind !== "mcp_events") return { ok: false, reason: "challenge_failed" };
      return verifyMcpCallback(parsed.data, safeFetch);
    },
  };
}

export { verify as verifyWebhookSignature } from "./standard-webhooks.js";
