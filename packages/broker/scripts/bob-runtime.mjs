import { once } from "node:events";
import { createOwnerRuntime, localReadTool } from "@team-31/broker/client";

// One outstanding call at a time on the demo's private IPC channel.
async function call(method, input) {
  const response = once(process, "message");
  process.send({ method, input });
  const [reply] = await response;
  if (reply.error) throw new Error(reply.error);
  return reply.value;
}

// This fixture belongs to Bob's process. Only the registered operation can read it.
const interests = new Set(["guitarra", "ciclismo"]);
const onWake = createOwnerRuntime({
  inbox: () => call("inbox"), reply: (_, input) => call("reply", input),
}, { userId: "bob", agentId: "bob-bot", scopes: ["nexo:inbox", "nexo:reply"] }, [
  localReadTool("interest_check", async ({ interest }) => ({
    matches: interests.has(interest.normalize("NFC").toLowerCase()),
  })),
]);
const [notice] = await once(process, "message");
try {
  console.log("Runtime de Bob activado por", notice.event);
  await onWake(notice);
} finally {
  process.disconnect();
}
