import { RESULT_EVENT, type WakeNotice, type WakeTarget } from "@team-31/protocol";
import type { SafePost } from "../safe-fetch.js";
import { signedHeaders } from "../standard-webhooks.js";

export function standardWebhookPost(
  target: Extract<WakeTarget, { kind: "standard_webhook" }>,
  { event, requestId }: WakeNotice,
): SafePost {
  const body = JSON.stringify({ event, requestId });
  return {
    url: target.url,
    headers: signedHeaders(target.secret, `evt_${event === RESULT_EVENT ? "closed_" : ""}${requestId}`, Math.floor(Date.now() / 1000), body),
    body,
  };
}
