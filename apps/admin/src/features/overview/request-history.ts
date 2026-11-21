import type { RequestSummary, Window } from "@shared/contract"
import type { RequestStatus } from "@team-31/protocol"
import { windowMs } from "@/lib/window"

export type Series = "open" | "ok" | "neutral" | "warn" | "error"
const seriesOf: Record<RequestStatus, Series> = {
  awaiting_agent: "open",
  awaiting_owner: "open",
  answered: "ok",
  no_data: "neutral",
  declined: "warn",
  denied: "warn",
  expired: "error",
  delivery_failed: "error",
}
export const bucketMs: Record<Window, number> = {
  "15m": 60_000,
  "1h": 5 * 60_000,
  "24h": 3_600_000,
  "7d": 12 * 3_600_000,
}

export function bucketize(
  items: readonly Pick<RequestSummary, "status" | "createdAt">[],
  window: Window,
  now: number
) {
  const size = bucketMs[window]
  const count = Math.round(windowMs[window] / size)
  const end = Math.ceil(now / size) * size
  const start = end - count * size
  const buckets = Array.from({ length: count }, (_, i) => ({
    t: start + i * size,
    ok: 0,
    neutral: 0,
    warn: 0,
    error: 0,
    open: 0,
  }))
  for (const r of items) {
    const index = Math.floor((Date.parse(r.createdAt) - start) / size)
    const bucket = buckets[index]
    if (bucket) bucket[seriesOf[r.status]] += 1
  }
  return buckets
}
