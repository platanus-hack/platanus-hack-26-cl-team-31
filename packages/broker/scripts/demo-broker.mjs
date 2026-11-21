import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { createOwnerRuntime, localReadTool } from "@team-31/broker/client";
import { SharingRules, WakeNotice } from "@team-31/protocol";
import { createWaker, verifyWebhookSignature } from "../../wake/dist/index.js";
import { askBob } from "./bob-runtime.mjs";

export async function startDemoBroker(source) {
  const ana = { userId: "ana", agentId: "ana-bot", scopes: ["nexo:ask", "nexo:status"] };
  const bob = { userId: "bob", agentId: "bob-bot", scopes: ["nexo:inbox", "nexo:reply"] };
  const addressDomain = "demo.local";
  const to = "bob@" + addressDomain;
  const secret = "whsec_" + randomBytes(32).toString("base64");
  const broker = createBroker({
    store: createMemoryStore(), clock: { now: () => new Date() },
    config: { requestTtlSeconds: 120, wakeRetryDelaysMs: [], addressDomain },
    nonceKey: randomBytes(32), signingKey: generateKeyPairSync("ed25519").privateKey,
    waker: createWaker({ allowInsecure: true }), // Localhost development mode.
  });
  const onWake = createOwnerRuntime(broker.agent, bob, [
    localReadTool("interest_check", ({ interest }) => askBob(interest, source)),
  ]);

  const inFlight = new Map();
  async function receive(req, res) {
    if (req.method !== "POST" || req.url !== "/agents/bob-bot/wake") return res.writeHead(404).end();
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 2048) return res.writeHead(413).end();
    }
    const timestamp = Number(req.headers["webhook-timestamp"]);
    const id = req.headers["webhook-id"];
    const signature = req.headers["webhook-signature"];
    if (typeof id !== "string" || typeof signature !== "string" || !Number.isSafeInteger(timestamp) ||
        Math.abs(Date.now() / 1000 - timestamp) > 60 || !verifyWebhookSignature(secret, id, timestamp, body, signature)) {
      return res.writeHead(401).end();
    }
    const notice = WakeNotice.parse(JSON.parse(body));
    if (id !== "evt_" + notice.requestId) return res.writeHead(400).end();
    res.writeHead(202).end();
    if (!inFlight.has(notice.requestId)) {
      console.error("bob-bot recibió el webhook firmado:", notice.requestId);
      const processing = onWake(notice).catch(() => {
        console.error("Bob no completó la consulta. La solicitud sigue pendiente hasta su vencimiento.");
      });
      inFlight.set(notice.requestId, processing);
    }
  }
  const receiver = createServer((req, res) => receive(req, res).catch(() => res.writeHead(400).end()));
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  try {
    await broker.owner.claimAddress(ana, "ana");
    await broker.owner.claimAddress(bob, "bob");
    await broker.owner.setRules(bob, SharingRules.parse({
      circles: {}, grants: {}, people: { ["ana@" + addressDomain]: [{ tool: "interest_check", fields: ["matches"] }] },
      defaultForUnknown: "deny",
    }));
    await broker.agent.connectWake(bob, {
      kind: "standard_webhook", url: `http://127.0.0.1:${receiver.address().port}/agents/bob-bot/wake`, secret,
    });
    return {
      async ask(tool, args) {
        const request = await broker.agent.ask(ana, { to, tool, args });
        console.error("Ana → broker:", request.decision, request.requestId);
        await broker.tick(new Date()); // HTTP 202 acknowledges the wake, not Bob's answer.
        return request;
      },
      async result(requestId) {
        await broker.tick(new Date());
        const current = await broker.agent.status(ana, requestId);
        const processing = inFlight.get(requestId);
        if (current.final || !processing) {
          if (current.final) inFlight.delete(requestId);
          return current;
        }
        await processing;
        inFlight.delete(requestId);
        await broker.tick(new Date());
        return broker.agent.status(ana, requestId);
      },
      close() { receiver.close(); },
    };
  } catch (error) {
    receiver.close();
    throw error;
  }
}
