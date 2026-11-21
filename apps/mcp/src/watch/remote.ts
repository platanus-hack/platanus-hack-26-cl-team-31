import { setTimeout } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { WAKE_EVENT } from "@team-31/protocol";
import { z } from "zod";

const catalog = z.object({ events: z.array(z.object({ name: z.string(), delivery: z.array(z.string()) })) });
const subscription = z.object({ id: z.string().regex(/^sub_[0-9a-f]{16}$/), refreshBefore: z.iso.datetime() });
const callbackFailure = z.object({ reason: z.enum(["challenge_failed", "timeout"]) });

export async function connect(url: URL, options: StreamableHTTPClientTransportOptions) {
  const client = new Client({ name: "sideband-terminal", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, options);
  try {
    await client.connect(transport, { timeout: 20_000 });
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    async supportsWebhook() {
      const { events } = await client.request({ method: "events/list" }, catalog, { timeout: 20_000 });
      return events.some((event) => event.name === WAKE_EVENT && event.delivery.includes("webhook"));
    },
    async subscribe(callback: URL, secret: string, signal?: AbortSignal) {
      const delays = [1_000, 2_000, 4_000, 8_000, 15_000];
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        try {
          // Don't abort an in-flight subscription: if it succeeds, the CLI needs its ID to clean up.
          return await client.request({
            method: "events/subscribe",
            params: { name: WAKE_EVENT, delivery: { mode: "webhook", url: callback.href, secret } },
          }, subscription, { timeout: 25_000 });
        } catch (error) {
          const delay = delays[attempt];
          // The tunnel can connect before public DNS propagates. Retry only when the
          // server explicitly rejected the challenge and therefore saved no subscription.
          if (delay === undefined || !(error instanceof McpError) || error.code !== -32015 ||
              !callbackFailure.safeParse(error.data).success) throw error;
          await setTimeout(delay, undefined, { signal });
        }
      }
    },
    unsubscribe: (id: string) => client.request({ method: "events/unsubscribe", params: { id } }, z.object({}), { timeout: 10_000 }),
    close: () => client.close(),
  };
}
