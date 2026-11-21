import type { WakeNotice, WakeTarget } from "@team-31/protocol";
import type { SafePost } from "../safe-fetch.js";
import { WAKE_INSTRUCTION } from "../text.js";

export function openclawPost(
  target: Extract<WakeTarget, { kind: "openclaw_hooks" }>,
  { requestId }: WakeNotice,
): SafePost {
  return {
    url: target.baseUrl,
    pathSuffix: "/hooks/agent",
    headers: {
      authorization: `Bearer ${target.token}`,
      "idempotency-key": requestId,
    },
    body: JSON.stringify({
      message: WAKE_INSTRUCTION(requestId),
      name: "Nexo",
      agentId: target.agentId,
      deliver: false,
      timeoutSeconds: 180,
    }),
  };
}
