import type { SinkStats, TelemetryRecord, TelemetrySink } from "../types.js";

export interface ConsoleSinkOptions {
  /** Destino de las líneas JSON. Por defecto process.stdout. */
  stream?: { write(chunk: string): unknown };
}

/** Escribe un JSON por línea. Útil en dev y como respaldo cuando no hay base. */
export function consoleSink(options: ConsoleSinkOptions = {}): TelemetrySink {
  const stream = options.stream ?? process.stdout;
  let written = 0;
  let failed = 0;
  return {
    write(record: TelemetryRecord) {
      try {
        stream.write(JSON.stringify({ ...record, at: record.at.toISOString() }) + "\n");
        written += 1;
      } catch {
        failed += 1;
      }
    },
    async flush() {},
    async close() {},
    stats(): SinkStats {
      return { queued: 0, dropped: 0, failed, written };
    },
  };
}

/** No escribe nada (TELEMETRY_SINK=off). */
export function offSink(): TelemetrySink {
  return {
    write() {},
    async flush() {},
    async close() {},
    stats: () => ({ queued: 0, dropped: 0, failed: 0, written: 0 }),
  };
}
