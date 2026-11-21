// Entrada del modo en vivo: filas de ops.events tal como llegan del stream (en orden de id, con
// duplicados tras reconectar y desordenadas entre servicios) → pasos en orden de ocurrencia.
//
// - Duplicados: una fila con un id ya recibido se descarta (el stream reenvía tras reconectar y el
//   servidor relee los últimos segundos para no perder escrituras que confirmaron tarde).
// - Orden: cada fila espera `holdMs` desde que llegó. Las listas para salir se ordenan por el
//   momento en que ocurrió el paso (inicio para spans) y luego por id. Así un span del MCP que se
//   escribió después que los eventos del broker que contiene se aplica en su lugar.
// - Reloj: el orden solo se corrige dentro de la ventana de espera, así que un servicio con el
//   reloj corrido no retiene a los demás más de `holdMs`.
import type { FlowEvent } from "./model.js";
import type { TelemetryMapper, TelemetryRow } from "./telemetry.js";

export interface LiveFeedOptions {
  /** Cuánto espera cada fila a otras que ocurrieron antes y llegaron después. */
  holdMs?: number;
  /** Ids recordados para descartar duplicados. */
  seenLimit?: number;
}

export interface LiveFeed {
  /** Agrega una fila recibida en `now` (ms). Devuelve false si era un duplicado. */
  push(row: TelemetryRow, now: number): boolean;
  /** Pasos de las filas que ya esperaron lo suficiente (todas con `flush`), en orden. */
  drain(now: number, flush?: boolean): FlowEvent[];
  /** Filas en espera. */
  readonly size: number;
}

const spanNames = new Set(["mcp.tool.call", "coordination.tool.call", "wake.attempt"]);

/** Momento en que ocurrió el paso: el inicio en los spans (que se escriben al terminar). */
export function occurredAt(row: Pick<TelemetryRow, "at" | "name" | "durationMs">): number {
  const end = typeof row.at === "number" ? row.at : Date.parse(row.at);
  return spanNames.has(row.name) && row.durationMs ? end - row.durationMs : end;
}

/** Compara ids numéricos de ops.events (bigint como string) sin perder precisión. */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length && /^\d+$/.test(a) && /^\d+$/.test(b)) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createLiveFeed(mapper: TelemetryMapper, { holdMs = 700, seenLimit = 10_000 }: LiveFeedOptions = {}): LiveFeed {
  const seen = new Set<string>();
  let buffer: { row: TelemetryRow; at: number; arrived: number }[] = [];
  return {
    push(row, now) {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      if (seen.size > seenLimit) seen.delete(seen.values().next().value as string);
      buffer.push({ row, at: occurredAt(row), arrived: now });
      return true;
    },
    drain(now, flush = false) {
      if (buffer.length === 0) return [];
      buffer.sort((a, b) => a.at - b.at || compareIds(a.row.id, b.row.id));
      // Sale en orden mientras la primera ya esperó: una fila tardía y anterior retiene a las demás
      // como mucho holdMs.
      let count = 0;
      while (count < buffer.length && (flush || now - buffer[count]!.arrived >= holdMs)) count++;
      if (count === 0) return [];
      const ready = buffer.slice(0, count);
      buffer = buffer.slice(count);
      return ready.flatMap(({ row }) => mapper.map(row));
    },
    get size() {
      return buffer.length;
    },
  };
}
