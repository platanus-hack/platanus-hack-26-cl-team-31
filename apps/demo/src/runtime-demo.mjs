import { runContactSession } from "./contact-session.mjs";

const [question, bobFile, janeFile, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Uso: corepack pnpm agents:runtime-demo "pregunta de Ana" [archivo de Bob] [archivo de Jane]');
const reply = await runContactSession(question, { bobFile, janeFile });
if (reply) {
  console.log(reply.text);
  for (const { data } of reply.traces) {
    if (data.requestId) console.log("Broker → Ana:", data.to, data.requestId, data.decision, data.result ?? data.outcome ?? data.waitingFor ?? "");
  }
}
