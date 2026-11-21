import type { SinkStats, TelemetryRecord, TelemetrySink } from "../types.js";

export interface MemorySink extends TelemetrySink {
  readonly records: TelemetryRecord[];
  /** Registros con ese nombre, en orden de emisión. */
  find(name: string): TelemetryRecord[];
  clear(): void;
}

/** Guarda los eventos en memoria. Para tests. */
export function memorySink(): MemorySink {
  const records: TelemetryRecord[] = [];
  return {
    records,
    write(record) {
      records.push(record);
    },
    find(name) {
      return records.filter((record) => record.name === name);
    },
    clear() {
      records.length = 0;
    },
    async flush() {},
    async close() {},
    stats(): SinkStats {
      return { queued: 0, dropped: 0, failed: 0, written: records.length };
    },
  };
}
