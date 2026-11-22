import { expect, it, vi } from "vitest";
import { createMemoryStore } from "../store/memory.js";
import { createLifecycleEvents } from "./events.js";

it("descarta los eventos ya registrados cuando la transacción se revierte", async () => {
  const emit = vi.fn();
  const events = createLifecycleEvents(createMemoryStore(), { emit });
  const failure = new Error("transacción abortada");

  await expect(events.store.tx(async (tx) => {
    events.record(tx, "broker.agent.connected", {
      userId: "alice", agentId: "alice-bot", attrs: { kind: "none" },
    });
    throw failure;
  })).rejects.toBe(failure);

  expect(emit).not.toHaveBeenCalled();
});
