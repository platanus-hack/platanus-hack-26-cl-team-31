import { randomBytes } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import { WAKE_EVENT, WakeNotice } from "@team-31/protocol";
import { verifyWebhookSignature } from "@team-31/wake";
import { z } from "zod";

export async function listen(handler: RequestListener, port = 0) {
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000 }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo abrir el puerto local.");
  return {
    origin: new URL(`http://127.0.0.1:${address.port}`),
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

const challengeSchema = z.strictObject({ type: z.literal("verification"), challenge: z.string().min(1) });
const eventSchema = z.strictObject({
  eventId: z.string(),
  name: z.literal(WAKE_EVENT),
  timestamp: z.iso.datetime(),
  data: WakeNotice.pick({ requestId: true }).extend({ requestId: z.uuid() }).strict(),
  cursor: z.null(),
});
const toleranceSeconds = 300;

export async function startReceiver(onRequest: (requestId: string) => void, port?: number) {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const path = `/events/${randomBytes(16).toString("hex")}`;
  const seen = new Map<string, number>();
  let subscription: string | undefined;
  const listener = await listen(async (req, res) => {
    if (req.method !== "POST" || req.url !== path) return res.writeHead(404).end();
    const id = req.headers["webhook-id"];
    const timestamp = req.headers["webhook-timestamp"];
    const signature = req.headers["webhook-signature"];
    const sub = req.headers["x-mcp-subscription-id"];
    const now = Date.now() / 1000;
    if (typeof id !== "string" || typeof signature !== "string" ||
        typeof sub !== "string" || !/^sub_[0-9a-f]{16}$/.test(sub) ||
        typeof timestamp !== "string" || !/^\d+$/.test(timestamp) ||
        Math.abs(now - Number(timestamp)) > toleranceSeconds || (subscription && sub !== subscription)) {
      return res.writeHead(401).end();
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const body = bytes.toString("utf8");
      if (!bytes.equals(Buffer.from(body)) || !verifyWebhookSignature(secret, id, Number(timestamp), body, signature)) {
        return res.writeHead(401).end();
      }
      const payload: unknown = JSON.parse(body);
      const challenge = challengeSchema.safeParse(payload);
      if (challenge.success) {
        subscription = sub;
        return res.writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ challenge: challenge.data.challenge }));
      }
      const event = eventSchema.safeParse(payload);
      if (!subscription || !event.success || event.data.eventId !== id || id !== `evt_${event.data.data.requestId}`) {
        return res.writeHead(400).end();
      }
      for (const [key, expires] of seen) {
        if (expires > now) break;
        seen.delete(key);
      }
      if (!seen.has(id)) {
        onRequest(event.data.data.requestId);
        seen.set(id, now + 24 * 60 * 60);
      }
      return res.writeHead(204).end();
    } catch {
      if (!res.destroyed) res.writeHead(400).end();
    }
  }, port);
  return { ...listener, path, secret };
}
