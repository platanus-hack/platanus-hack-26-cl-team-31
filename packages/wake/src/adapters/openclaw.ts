import { RESULT_EVENT, type WakeNotice, type WakeTarget } from "@team-31/protocol";
import type { SafePost } from "../safe-fetch.js";
import { WAKE_INSTRUCTION } from "../text.js";

export function openclawPost(
  target: Extract<WakeTarget, { kind: "openclaw_hooks" }>,
  notice: WakeNotice,
): SafePost {
  return {
    url: target.baseUrl,
    pathSuffix: "/hooks/agent",
    headers: {
      authorization: `Bearer ${target.token}`,
      "idempotency-key": notice.event === RESULT_EVENT ? `closed_${notice.requestId}` : notice.requestId,
    },
    body: JSON.stringify({
      message: WAKE_INSTRUCTION(notice),
      name: "Sideband",
      agentId: target.agentId,
      deliver: false,
      timeoutSeconds: 180,
    }),
  };
}
