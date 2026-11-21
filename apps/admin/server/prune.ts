import type pg from "pg"
import { logFailure } from "./errors.js"

// Retención de telemetría: SELECT ops.prune_events(interval) una vez por hora
// (TELEMETRY_RETENTION_DAYS). La función la crea ADM-02; si aún no existe, no hace nada.
export function startPruneTask(pool: pg.Pool, retentionDays: number, { intervalMs = 3_600_000, initialDelayMs = 60_000 } = {}) {
  async function run() {
    try {
      const { rows } = await pool.query<{ ready: boolean }>(
        "SELECT to_regprocedure('ops.prune_events(interval)') IS NOT NULL AS ready",
      )
      if (!rows[0]?.ready) return
      await pool.query("SELECT ops.prune_events(make_interval(days => $1::int))", [retentionDays])
    } catch (error) {
      logFailure("ops.prune_events", error)
    }
  }
  const first = setTimeout(() => void run(), initialDelayMs)
  const timer = setInterval(() => void run(), intervalMs)
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
