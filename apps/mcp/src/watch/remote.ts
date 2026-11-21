import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WAKE_EVENT } from "@team-31/protocol";
import { z } from "zod";

const catalog = z.object({ events: z.array(z.object({ name: z.string(), delivery: z.array(z.string()) })) });
const subscription = z.object({ id: z.string().regex(/^sub_[0-9a-f]{16}$/), refreshBefore: z.iso.datetime() });

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
    subscribe: (callback: URL, secret: string) => client.request({
      method: "events/subscribe",
      params: { name: WAKE_EVENT, delivery: { mode: "webhook", url: callback.href, secret } },
    }, subscription, { timeout: 25_000 }),
    unsubscribe: (id: string) => client.request({ method: "events/unsubscribe", params: { id } }, z.object({}), { timeout: 10_000 }),
    close: () => client.close(),
  };
}
