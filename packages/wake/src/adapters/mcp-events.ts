import { randomBytes, timingSafeEqual } from "node:crypto";
import { LIFECYCLE_EVENT, RESULT_EVENT, type WakeNotice, type WakeTarget, type Waker } from "@team-31/protocol";
import type { SafeFetch, SafePost } from "../safe-fetch.js";
import { signedHeaders } from "../standard-webhooks.js";

type McpEventsTarget = Extract<WakeTarget, { kind: "mcp_events" }>;
type Verification = Awaited<ReturnType<Waker["verifyCallback"]>>;

function signedPost(target: McpEventsTarget, id: string, date: Date, body: string): SafePost {
  return {
    url: target.callbackUrl,
    headers: {
      ...signedHeaders(target.secret, id, Math.floor(date.getTime() / 1000), body),
      "x-mcp-subscription-id": target.subscriptionId,
    },
    body,
  };
}

export function mcpEventsPost(target: McpEventsTarget, { event, requestId }: WakeNotice): SafePost {
  const eventId = `evt_${event === RESULT_EVENT ? "closed_" : ""}${requestId}`;
  const date = new Date();
  return signedPost(target, eventId, date, JSON.stringify({
    eventId,
    name: target.lifecycle ? LIFECYCLE_EVENT : event,
    timestamp: date.toISOString(),
    data: target.lifecycle ? { requestId, event } : { requestId },
    cursor: null,
  }));
}

export async function verifyMcpCallback(target: McpEventsTarget, safeFetch: SafeFetch): Promise<Verification> {
  const challenge = randomBytes(18).toString("base64url");
  const id = `msg_verification_${randomBytes(18).toString("base64url")}`;
  const body = JSON.stringify({ type: "verification", challenge });

  try {
    const result = await safeFetch(signedPost(target, id, new Date(), body));
    if ("failure" in result) {
      return { ok: false, reason: result.failure === "network_error" ? "challenge_failed" : result.failure };
    }
    if (result.status >= 200 && result.status < 300 && result.body) {
      const response: unknown = JSON.parse(result.body.toString());
      if (response && typeof response === "object" && "challenge" in response && typeof response.challenge === "string") {
        const expected = Buffer.from(challenge);
        const received = Buffer.from(response.challenge);
        if (expected.length === received.length && timingSafeEqual(expected, received)) return { ok: true };
      }
    }
  } catch {
    return { ok: false, reason: "challenge_failed" };
  }
  return { ok: false, reason: "challenge_failed" };
}
