import type { BrokerCore } from "@team-31/broker";
import type { Telemetry } from "@team-31/telemetry";

export function startWorker(broker: Pick<BrokerCore, "tick">, telemetry: Pick<Telemetry, "emit" | "error">, runInWorker: <T>(fn: () => T) => T = (fn) => fn()) {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = runInWorker(async () => {
      try {
        const report = await broker.tick(new Date());
        if (Object.values(report).some((count) => count !== 0)) telemetry.emit("worker.tick.completed", { attrs: report });
      } catch (error) {
        telemetry.error("worker.tick", error);
      }
    }).finally(() => { running = undefined; });
  }, 1_000);

  return async function stopWorker() {
    clearInterval(timer);
    await running;
  };
}
