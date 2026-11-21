import { z } from "zod";

// El contrato del admin importa estos esquemas. La prueba de postgresSink los compara
// con los CHECK de ops.events después de aplicar las migraciones.
export const Service = z.enum(["web", "mcp", "broker", "worker", "admin", "coordination"]);
export type Service = z.infer<typeof Service>;

export const EventKind = z.enum(["http", "tool", "lifecycle", "wake", "policy", "auth", "error", "admin"]);
export type EventKind = z.infer<typeof EventKind>;

export const Level = z.enum(["debug", "info", "warn", "error"]);
export type Level = z.infer<typeof Level>;

export type Scalar = string | number | boolean | null;

/** Una fila de ops.events lista para escribirse. attrs ya pasó por el catálogo. */
export interface TelemetryRecord {
  at: Date;
  service: Service;
  instance: string;
  kind: EventKind;
  name: string;
  level: Level;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  requestId: string | null;
  userId: string | null;
  agentId: string | null;
  durationMs: number | null;
  status: string | null;
  errorId: string | null;
  attrs: Record<string, Scalar>;
}

export interface SinkStats {
  /** Eventos esperando en la cola. */
  queued: number;
  /** Eventos descartados porque la cola estaba llena. */
  dropped: number;
  /** Eventos perdidos porque el destino falló al escribir. */
  failed: number;
  /** Eventos escritos con éxito. */
  written: number;
}

/** Destino de los eventos. write() nunca lanza ni bloquea. */
export interface TelemetrySink {
  write(record: TelemetryRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  stats(): SinkStats;
}
