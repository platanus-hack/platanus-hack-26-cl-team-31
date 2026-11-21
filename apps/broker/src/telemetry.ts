import { AsyncLocalStorage } from "node:async_hooks";
import type { BrokerTelemetry } from "@team-31/broker";
import { createTelemetry, sinkFromEnv, type Telemetry, type TelemetrySink } from "@team-31/telemetry";
import type { WakerTelemetry } from "@team-31/wake";

export type BrokerServiceTelemetry = {
  /** Service "broker": HTTP spans, authentication and requests from mcp and web. */
  http: Telemetry;
  /** Service "worker": expiry sweep and wake attempts. */
  worker: Telemetry;
  /** For the core and the waker: writes as worker inside runInWorker() and as broker otherwise. */
  shared: BrokerTelemetry & WakerTelemetry;
  runInWorker<T>(fn: () => T): T;
  shutdown(): Promise<void>;
};

/**
 * One process hosts the HTTP server and the worker. Each reports its own service (and heartbeat)
 * over a single sink, so the admin sees `broker` and `worker` separately.
 */
export function createBrokerTelemetry({ sink = sinkFromEnv(), version = process.env.npm_package_version, heartbeatMs }: {
  sink?: TelemetrySink;
  version?: string;
  heartbeatMs?: number;
} = {}): BrokerServiceTelemetry {
  // Each instance gets a view whose close() only flushes, so both can emit service.stopping
  // before the real sink closes.
  const view: TelemetrySink = {
    write: (record) => sink.write(record),
    flush: () => sink.flush(),
    close: () => sink.flush(),
    stats: () => sink.stats(),
  };
  const http = createTelemetry({ service: "broker", version, sink: view, heartbeatMs });
  const worker = createTelemetry({ service: "worker", version, sink: view, heartbeatMs });
  const inWorker = new AsyncLocalStorage<true>();
  const current = () => (inWorker.getStore() ? worker : http);

  return {
    http,
    worker,
    shared: {
      error: (operation, error, fields) => current().error(operation, error, fields),
      emit: (name, fields) => current().emit(name, fields),
      span: (name, fields, fn) => current().span(name, fields, fn),
    },
    runInWorker: (fn) => inWorker.run(true, fn),
    async shutdown() {
      await Promise.all([http.shutdown(), worker.shutdown()]);
      await sink.close().catch(() => undefined);
    },
  };
}
