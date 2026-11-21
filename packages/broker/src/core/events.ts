import type { EventFields, EventName, Telemetry } from "@team-31/telemetry";
import type { Store, StoreTx } from "../store/store.js";

/** Optional telemetry for the core. The service injects it; the core never creates one. */
export type BrokerTelemetry = Pick<Telemetry, "emit">;

export type RecordEvent = <N extends EventName>(tx: StoreTx, name: N, fields: EventFields<N>) => void;

type Pending = () => void;

/**
 * Lifecycle events are recorded inside a transaction and emitted only after it commits, so a
 * rolled back transition never shows up in ops.events.
 */
export function createLifecycleEvents(store: Store, telemetry?: BrokerTelemetry) {
  const pending = new WeakMap<StoreTx, Pending[]>();

  const observedStore: Store = {
    async tx(fn) {
      let buffer: Pending[] = [];
      const result = await store.tx((tx) => {
        // A store may retry the callback: each attempt starts with an empty buffer.
        buffer = [];
        pending.set(tx, buffer);
        return fn(tx);
      });
      for (const emitPending of buffer) emitPending();
      return result;
    },
  };

  const record: RecordEvent = (tx, name, fields) => {
    if (!telemetry) return;
    const buffer = pending.get(tx);
    if (buffer) buffer.push(() => telemetry.emit(name, fields));
    else telemetry.emit(name, fields);
  };

  const emit = <N extends EventName>(name: N, fields: EventFields<N>) => telemetry?.emit(name, fields);

  return { store: observedStore, record, emit };
}
