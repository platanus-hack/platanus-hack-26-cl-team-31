import type { BrokerCore } from "@team-31/broker";
import { logFailure } from "./log.js";

export function startWorker(broker: Pick<BrokerCore, "tick">) {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = (async () => {
      try {
        const report = await broker.tick(new Date());
        if (Object.values(report).some((count) => count !== 0)) console.info("[broker] Worker", report);
      } catch (error) {
        logFailure("worker.tick", error);
      }
    })().finally(() => { running = undefined; });
  }, 1_000);

  return async function stopWorker() {
    clearInterval(timer);
    await running;
  };
}
