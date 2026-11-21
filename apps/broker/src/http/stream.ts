import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { OwnerPort } from "@team-31/broker";
import { routes } from "@team-31/protocol/http";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Telemetry } from "@team-31/telemetry";
import type { AuthContext } from "./auth.js";

const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const SNAPSHOT_SIZE = 30;

export async function ownerStream(
  c: Context<AuthContext>,
  owner: OwnerPort,
  schema: typeof routes.ownerStream.response,
  telemetry: Pick<Telemetry, "error">,
  shutdown?: AbortSignal,
) {
  const identity = c.get("web");
  const snapshot = async () => (await owner.activity(identity, SNAPSHOT_SIZE)).map((item) => schema.parse(item));
  const initial = await snapshot();

  c.header("X-Accel-Buffering", "no");
  const response = streamSSE(c, async (stream) => {
    const disconnected = new AbortController();
    stream.onAbort(() => disconnected.abort());
    const signals = [c.req.raw.signal, disconnected.signal];
    if (shutdown) signals.push(shutdown);
    const signal = AbortSignal.any(signals);
    const abort = () => stream.abort();
    signal.addEventListener("abort", abort, { once: true });

    let previous = new Map<string, string>();
    let items = initial;
    let heartbeatAt = Date.now() + HEARTBEAT_MS;
    try {
      if (signal.aborted) return;
      await stream.write("retry: 1000\n\n");
      while (!signal.aborted) {
        const current = new Map<string, string>();
        for (const item of [...items].reverse()) {
          if (signal.aborted) return;
          const data = JSON.stringify(item);
          const id = createHash("sha256").update(data).digest("base64url");
          current.set(item.requestId, id);
          if (previous.get(item.requestId) !== id) await stream.writeSSE({ id, event: "activity", data });
        }
        previous = current;
        if (Date.now() >= heartbeatAt) {
          await stream.write(": heartbeat\n\n");
          heartbeatAt = Date.now() + HEARTBEAT_MS;
        }
        await setTimeout(POLL_MS, undefined, { signal });
        items = await snapshot();
      }
    } catch (error) {
      if (!signal.aborted) telemetry.error(`GET ${routes.ownerStream.path}`, error);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
