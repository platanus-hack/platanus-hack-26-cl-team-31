import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { createOwnerRuntime, localReadTool } from "@team-31/broker/client";
import { SharingRules, WakeNotice } from "@team-31/protocol";
import { createWaker, verifyWebhookSignature } from "../../wake/dist/index.js";
import { askContactOwner } from "./contact-runtime.mjs";

export async function startDemoBroker(contacts) {
  const ana = { userId: "ana", agentId: "ana-bot", scopes: ["nexo:ask", "nexo:status"] };
  const addressDomain = "demo.local";
  const addressBook = contacts.map(({ id, name }) => ({ name, address: `${id}@${addressDomain}` }));
  const broker = createBroker({
    store: createMemoryStore(), clock: { now: () => new Date() },
    config: { requestTtlSeconds: 120, wakeRetryDelaysMs: [], addressDomain },
    nonceKey: randomBytes(32), signingKey: generateKeyPairSync("ed25519").privateKey,
    waker: createWaker({ allowInsecure: true }), // Localhost development mode.
  });
  const routes = new Map();
  const inFlight = new Map();
  async function receive(req, res) {
    const target = routes.get(req.url);
    if (req.method !== "POST" || !target) return res.writeHead(404).end();
    const { name, secret, onWake } = target;
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
      console.error(`${name} recibió el webhook firmado:`, notice.requestId);
      const processing = onWake(notice).catch(() => {
        console.error(`${name} no completó la consulta. La solicitud sigue pendiente hasta su vencimiento.`);
      });
      inFlight.set(notice.requestId, processing);
    }
  }
  const receiver = createServer((req, res) => receive(req, res).catch(() => res.writeHead(400).end()));
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  try {
    await broker.owner.claimAddress(ana, "ana");
    for (const { id, name, source, allowsInterest } of contacts) {
      const owner = { userId: id, agentId: id + "-bot", scopes: ["nexo:inbox", "nexo:reply"] };
      const path = `/agents/${owner.agentId}/wake`;
      const secret = "whsec_" + randomBytes(32).toString("base64");
      const onWake = createOwnerRuntime(broker.agent, owner, [
        localReadTool("interest_check", ({ interest }) => askContactOwner(name, interest, source)),
      ]);
      routes.set(path, { name, secret, onWake });
      await broker.owner.claimAddress(owner, id);
      await broker.owner.setRules(owner, SharingRules.parse({
        circles: {}, grants: {},
        people: allowsInterest ? { ["ana@" + addressDomain]: [{ tool: "interest_check", fields: ["matches"] }] } : {},
        defaultForUnknown: "deny",
      }));
      await broker.agent.connectWake(owner, {
        kind: "standard_webhook", url: `http://127.0.0.1:${receiver.address().port}${path}`, secret,
      });
    }
    // A concurrent ask can have its wake claimed by the preceding tick.
    let dispatched = Promise.resolve();
    function dispatch() {
      const tick = dispatched.then(() => broker.tick(new Date()));
      dispatched = tick.catch(() => {});
      return tick;
    }
    return {
      listContacts() { return addressBook; },
      async ask(to, tool, args) {
        if (!addressBook.some(contact => contact.address === to)) throw new Error("Contacto fuera de la agenda de Ana.");
        const request = await broker.agent.ask(ana, { to, tool, args });
        console.error("Ana → broker:", request.decision, request.requestId);
        await dispatch(); // HTTP 202 acknowledges the wake, before the contact answers.
        return request;
      },
      async result(requestId) {
        await dispatch();
        const current = await broker.agent.status(ana, requestId);
        const processing = inFlight.get(requestId);
        if (current.final || !processing) {
          if (current.final) inFlight.delete(requestId);
          return current;
        }
        await processing;
        inFlight.delete(requestId);
        await dispatch();
        return broker.agent.status(ana, requestId);
      },
      close() { receiver.close(); },
    };
  } catch (error) {
    receiver.close();
    throw error;
  }
}
