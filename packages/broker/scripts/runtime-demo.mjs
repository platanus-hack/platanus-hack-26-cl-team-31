// Local transport for the demo: this IPC channel is bound to Bob's principal.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { SharingRules } from "@team-31/protocol";

const ana = { userId: "ana", agentId: "ana-bot", scopes: ["nexo:ask", "nexo:status"] };
const bob = { userId: "bob", agentId: "bob-bot", scopes: ["nexo:inbox", "nexo:reply"] };
const addressDomain = "demo.local";
const to = "bob@" + addressDomain;

async function wakeBob(_target, notice) {
  const child = fork(new URL("./bob-runtime.mjs", import.meta.url), [], { env: {}, timeout: 8000 });
  const exited = once(child, "exit");
  child.on("message", async ({ method, input }) => {
    try {
      let value;
      if (method === "inbox") value = await broker.agent.inbox(bob);
      else if (method === "reply") value = await broker.agent.reply(bob, input);
      else throw new Error("Operación desconocida");
      child.send({ value });
    } catch {
      if (child.connected) child.send({ error: "Operación rechazada por el broker" });
    }
  });
  const started = Date.now();
  child.send(notice);
  const [code] = await exited;
  return { ok: code === 0, retryable: false, ms: Date.now() - started };
}

const broker = createBroker({
  store: createMemoryStore(),
  clock: { now: () => new Date() },
  config: { requestTtlSeconds: 60, wakeRetryDelaysMs: [], addressDomain },
  nonceKey: randomBytes(32), signingKey: generateKeyPairSync("ed25519").privateKey,
  waker: { wake: wakeBob, verifyCallback: async () => ({ ok: false, reason: "challenge_failed" }) },
});
await broker.owner.claimAddress(ana, "ana");
await broker.owner.claimAddress(bob, "bob");
await broker.owner.setRules(bob, SharingRules.parse({
  publicProfile: { displayName: "Bob" }, circles: {}, grants: {},
  people: { ["ana@" + addressDomain]: [{ tool: "interest_check", fields: ["matches"] }] },
  defaultForUnknown: "deny",
}));
// Only selects the demo waker above. This demo sends no HTTP callbacks.
await broker.agent.connectWake(bob, { kind: "standard_webhook", url: "https://bob.invalid/", secret: "whsec_demo" });
const catalog = await broker.agent.capabilities(ana, to);
console.log("Ana descubre", catalog.tools.map(t => [t.tool, t.execution]));
const profile = await broker.agent.ask(ana, { to, tool: "profile", args: {} });
assert.equal(profile.final, true);
console.log("Perfil publicado, sin despertar a Bob:", profile.result);
const request = await broker.agent.ask(ana, { to, tool: "interest_check", args: { interest: "guitarra" } });
assert.equal(request.waitingFor, "agent");
console.log("Consulta de Ana pendiente:", request.requestId);
await broker.tick(new Date());
const final = await broker.agent.status(ana, request.requestId);
assert.deepEqual(final.result, { matches: true });
console.log("Resultado firmado entregado a Ana:", final.result);
