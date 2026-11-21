import { expect, it } from "vitest";
import { runStoreContractTests } from "./contract.js";
import { createMemoryStore } from "./memory.js";

runStoreContractTests(createMemoryStore);

it("does not expose mutable store references", async () => {
  const store = createMemoryStore();
  const agent = {
    userId: "alice", agentId: "bot", label: "Bot", wakeTarget: { kind: "none" as const }, createdAt: new Date(),
  };
  const row = await store.tx((tx) => tx.ensureAgentConnection(agent));
  row.label = "Modified";
  agent.label = "Modified again";
  expect(await store.tx((tx) => tx.getAgentConnection("alice", "bot"))).toMatchObject({ label: "Bot" });
});
