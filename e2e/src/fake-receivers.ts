import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WAKE_EVENT, type WakeTarget } from "@team-31/protocol";
import { z } from "zod";

const notice = z.strictObject({ event: z.literal(WAKE_EVENT), requestId: z.uuid() });
const claw = z.strictObject({
  message: z.string(),
  name: z.literal("Nexo"),
  agentId: z.literal("main"),
  deliver: z.literal(false),
  timeoutSeconds: z.number(),
});
const routine = notice.extend({ instruction: z.string() });
const verifiedEvent = z.strictObject({
  eventId: z.string(),
  name: z.literal(WAKE_EVENT),
  timestamp: z.iso.datetime(),
  data: z.strictObject({ requestId: z.uuid() }),
  cursor: z.null(),
});
const verification = z.strictObject({ type: z.literal("verification"), challenge: z.string().min(1) });

// Hooks may carry this fixed instruction. A second paragraph, or any change that
// puts sender text in the instruction, must be rejected even with a valid token.
function wakeInstruction(id: string) {
  return `Tienes una solicitud nueva en Nexo (${id}). Usa nexo_inbox para leerla y respóndela con nexo_reply usando su requestId y nonce. Siempre debes responder: si no tienes la información usa outcome "no_data", si necesitas que tu dueño decida usa "needs_owner" y si prefieres no compartir usa "declined". Comparte solo los campos permitidos.`;
}

function verifySignature(headers: IncomingMessage["headers"], body: Buffer, key: Buffer) {
  const { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature } = headers;
  assert(typeof id === "string" && id.length > 0);
  assert(typeof timestamp === "string" && /^\d+$/.test(timestamp));
  assert(Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300);
  assert(typeof signature === "string");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
  assert(signature.split(/\s+/).some((value) => {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(value);
    return match && timingSafeEqual(expected, Buffer.from(match[1]!, "base64"));
  }));
  return id;
}

export async function startFakeReceivers() {
  const token = randomBytes(24).toString("base64url");
  const key = randomBytes(32);
  const secret = `whsec_${key.toString("base64")}`;
  const attempts: { requestId: string; kind: WakeTarget["kind"] }[] = [];
  const rejections: string[] = [];
  const subscriptionIds = new Set<string>();

  async function receive(req: IncomingMessage, res: ServerResponse) {
    assert.equal(req.method, "POST");
    const path = req.url;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16_384) throw new Error("Aviso demasiado largo.");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const payload: unknown = JSON.parse(body.toString("utf8"));
    switch (path) {
      case "/hooks/agent": {
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        const requestId = z.uuid().parse(req.headers["idempotency-key"]);
        assert(claw.parse(payload).message === wakeInstruction(requestId));
        attempts.push({ requestId, kind: "openclaw_hooks" });
        return res.writeHead(204).end();
      }
      case "/routine": {
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        const { requestId, instruction } = routine.parse(payload);
        assert(instruction === wakeInstruction(requestId));
        attempts.push({ requestId, kind: "grokbot_routine" });
        return res.writeHead(200).end();
      }
      case "/events": {
        const eventId = verifySignature(req.headers, body, key);
        const subscriptionId = z.string().min(1).parse(req.headers["x-mcp-subscription-id"]);
        const challenge = verification.safeParse(payload);
        if (challenge.success) {
          subscriptionIds.add(subscriptionId);
          return res.writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ challenge: challenge.data.challenge }));
        }
        const event = verifiedEvent.parse(payload);
        assert(subscriptionIds.has(subscriptionId));
        assert.equal(event.eventId, eventId);
        assert.equal(eventId, `evt_${event.data.requestId}`);
        attempts.push({ requestId: event.data.requestId, kind: "mcp_events" });
        return res.writeHead(204).end();
      }
      case "/webhook/failure": {
        const eventId = verifySignature(req.headers, body, key);
        const { requestId } = notice.parse(payload);
        assert.equal(eventId, `evt_${requestId}`);
        attempts.push({ requestId, kind: "standard_webhook" });
        return res.writeHead(500).end();
      }
      default:
        throw new Error("Ruta de aviso inesperada.");
    }
  }

  const server = createServer((req, res) => {
    void receive(req, res).catch(() => {
      // Keep the body and credentials out of test failure logs.
      rejections.push(req.url?.split("?")[0] ?? "");
      res.writeHead(400).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    attempts,
    rejections,
    openClaw: { kind: "openclaw_hooks", baseUrl: base, token, agentId: "main" } satisfies WakeTarget,
    grokBot: { kind: "grokbot_routine", url: `${base}/routine`, key: token } satisfies WakeTarget,
    events: { url: `${base}/events`, secret },
    failingWebhook: { kind: "standard_webhook", url: `${base}/webhook/failure`, secret } satisfies WakeTarget,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
