// Calendario de reproducción: en qué momento del reloj (ms) se aplica cada paso.
// Puro y probado aparte del componente.
import type { FlowEvent } from "./model.js";

export interface ScheduleOptions {
  /** Separación mínima entre pasos para que cada pulso se alcance a ver. */
  minGap?: number;
  /** Las pausas largas del escenario se acortan a esto. */
  maxGap?: number;
  /** Retraso del primer paso. */
  lead?: number;
}

export const PULSE_MS = 900;
export const EDGE_MS = 1_700;
export const LABEL_MS = 2_400;

/** Modo repetición: respeta los tiempos relativos, acotados entre minGap y maxGap. */
export function scheduleReplay(events: readonly FlowEvent[], { minGap = 420, maxGap = 2_600, lead = 600 }: ScheduleOptions = {}): number[] {
  const times: number[] = [];
  let previousAt: number | undefined;
  let previousStep: FlowEvent["step"] | undefined;
  let previousT = lead - minGap;
  for (const event of events) {
    // La foto inicial de la red se aplica de una vez, antes del primer paso.
    if (event.meta.snapshot) {
      times.push(0);
      continue;
    }
    // Varias entradas seguidas se leen como una ola: 150 ms entre cada una.
    const wave = event.step === "joined" && previousStep === "joined" && previousAt !== undefined && event.at - previousAt < 1_000;
    const gap = previousAt === undefined ? minGap : wave ? 150 : Math.min(maxGap, Math.max(minGap, event.at - previousAt));
    previousT += gap;
    times.push(previousT);
    previousAt = event.at;
    previousStep = event.step;
  }
  return times;
}

/** Modo en vivo: un paso nuevo se aplica ahora o, si llegó en ráfaga, minGap después del anterior. */
export function scheduleLive(previous: number | undefined, clock: number, minGap = 320, snapshot = false): number {
  if (snapshot) return previous ?? clock;
  return previous === undefined ? clock : Math.max(clock, previous + minGap);
}
