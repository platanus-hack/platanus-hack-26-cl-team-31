import pg from "pg";
import { summarizeError } from "../redact.js";
import type { SinkStats, TelemetryRecord, TelemetrySink } from "../types.js";

/** Lo mínimo que el sink necesita de un pg.Pool (permite inyectar uno falso en tests). */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface PostgresSinkOptions {
  connectionString?: string;
  /** Pool propio. Si se pasa, close() no lo cierra. */
  pool?: Queryable;
  /** Filas por INSERT. Por defecto 200. */
  batchSize?: number;
  /** Espera máxima antes de escribir un lote incompleto. Por defecto 500 ms. */
  flushIntervalMs?: number;
  /** Tamaño máximo de la cola. Si se llena, descarta y cuenta `dropped`. Por defecto 5000. */
  maxQueue?: number;
}

const INSERT = `
INSERT INTO ops.events
  (at, service, instance, kind, name, level, trace_id, span_id, parent_span_id,
   request_id, user_id, agent_id, duration_ms, status, error_id, attrs)
SELECT * FROM unnest(
  $1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
  $9::text[], $10::text[], $11::text[], $12::text[], $13::integer[], $14::text[], $15::uuid[], $16::jsonb[]
)`;

function toColumns(batch: TelemetryRecord[]): unknown[][] {
  const columns: unknown[][] = Array.from({ length: 16 }, () => []);
  for (const r of batch) {
    const row = [
      r.at, r.service, r.instance, r.kind, r.name, r.level, r.traceId, r.spanId, r.parentSpanId,
      r.requestId, r.userId, r.agentId, r.durationMs === null ? null : Math.round(r.durationMs),
      r.status, r.errorId, JSON.stringify(r.attrs),
    ];
    row.forEach((value, index) => columns[index]!.push(value));
  }
  return columns;
}

/**
 * Escribe en ops.events por lotes (200 filas o cada 500 ms). write() nunca bloquea ni lanza:
 * si la cola está llena descarta y cuenta; si el INSERT falla, pierde el lote y cuenta `failed`.
 */
export function postgresSink(input: string | PostgresSinkOptions): TelemetrySink {
  const options = typeof input === "string" ? { connectionString: input } : input;
  const batchSize = options.batchSize ?? 200;
  const flushIntervalMs = options.flushIntervalMs ?? 500;
  const maxQueue = options.maxQueue ?? 5000;
  const ownsPool = !options.pool;
  if (ownsPool && !options.connectionString) {
    throw new Error("postgresSink exige connectionString o pool.");
  }
  const pool: Queryable = options.pool ?? createPool(options.connectionString!);

  const queue: TelemetryRecord[] = [];
  const stats: SinkStats = { queued: 0, dropped: 0, failed: 0, written: 0 };
  let timer: NodeJS.Timeout | null = null;
  let chain: Promise<void> = Promise.resolve();
  let scheduled = false;
  let closed = false;
  let lastReport = 0;

  function report(error: unknown, lost: number) {
    // Sin mensaje crudo: solo tipo y código. Como mucho una línea cada 10 s.
    const now = Date.now();
    if (now - lastReport < 10_000) return;
    lastReport = now;
    const { type, code } = summarizeError(error);
    process.stderr.write(JSON.stringify({ telemetry: "postgres_sink_error", type, code, lost }) + "\n");
  }

  async function writeAll() {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      try {
        await pool.query(INSERT, toColumns(batch));
        stats.written += batch.length;
      } catch (error) {
        stats.failed += batch.length;
        report(error, batch.length);
      }
    }
  }

  function drain(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!scheduled) {
      scheduled = true;
      chain = chain.then(async () => {
        scheduled = false;
        await writeAll();
      });
    }
    return chain;
  }

  return {
    write(record) {
      if (closed || queue.length >= maxQueue) {
        stats.dropped += 1;
        return;
      }
      queue.push(record);
      if (queue.length >= batchSize) {
        void drain();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          void drain();
        }, flushIntervalMs);
        timer.unref();
      }
    },
    flush: () => drain(),
    async close() {
      if (closed) return chain;
      closed = true;
      await drain();
      if (ownsPool) await pool.end().catch(() => undefined);
    },
    stats: () => ({ ...stats, queued: queue.length }),
  };
}

function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
  // Un cliente inactivo que pierde la conexión no debe tumbar el proceso.
  pool.on("error", () => undefined);
  return pool;
}
