import { setTimeout } from "node:timers/promises";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

const permanentErrors = new Set(["forbidden", "unauthorized", "not_found", "tool_error"]);

export async function pollInbox({
  inbox, signal, onReady, onRequest, onRetry, intervalMs = 2_000,
}: {
  inbox: (signal: AbortSignal) => Promise<string[]>;
  signal: AbortSignal;
  onReady: () => void;
  onRequest: (id: string) => void;
  onRetry: () => void;
  intervalMs?: number;
}) {
  const seen = new Set<string>();
  let ready = false;
  let delay = 0;
  while (!signal.aborted) {
    if (delay) await setTimeout(delay, undefined, { signal });
    let ids: string[];
    try {
      ids = await inbox(signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof McpError &&
          (error.code === ErrorCode.InvalidParams || permanentErrors.has((error.data as { reason?: string })?.reason ?? ""))) {
        throw error;
      }
      if (delay <= intervalMs) onRetry();
      delay = Math.min(30_000, Math.max(intervalMs * 2, delay * 2));
      continue;
    }
    if (signal.aborted) return;
    for (const id of ids) {
      if (ready && !seen.has(id)) onRequest(id);
      seen.add(id);
    }
    if (!ready) onReady();
    ready = true;
    delay = intervalMs;
  }
}
