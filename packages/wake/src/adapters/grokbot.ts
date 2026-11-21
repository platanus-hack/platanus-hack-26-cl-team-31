import type { WakeNotice, WakeTarget } from "@team-31/protocol";
import type { SafePost } from "../safe-fetch.js";
import { WAKE_INSTRUCTION } from "../text.js";

export function grokbotPost(
  target: Extract<WakeTarget, { kind: "grokbot_routine" }>,
  { event, requestId }: WakeNotice,
): SafePost {
  return {
    url: target.url,
    headers: { authorization: `Bearer ${target.key}` },
    body: JSON.stringify({ event, requestId, instruction: WAKE_INSTRUCTION(requestId) }),
  };
}
