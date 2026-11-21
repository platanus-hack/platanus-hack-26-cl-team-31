import { BrokerError } from "@team-31/broker";

const limits = { ask: 30, reply: 120, other: 300 } as const;
const WINDOW_MS = 60_000;
type Bucket = keyof typeof limits;

export interface RateLimiter {
  consume(userId: string, bucket: Bucket): Promise<{ retryAfter: number } | undefined>;
}

export function createMemoryRateLimiter(now = Date.now): RateLimiter {
  const buckets: Record<Bucket, Map<string, { count: number; resetAt: number }>> = {
    ask: new Map(), reply: new Map(), other: new Map(),
  };
  let nextCleanup = 0;
  return {
    async consume(userId, bucket) {
      const time = now();
      if (time >= nextCleanup) {
        for (const records of Object.values(buckets)) {
          for (const [id, record] of records) {
            if (record.resetAt <= time) records.delete(id);
          }
        }
        nextCleanup = time + WINDOW_MS;
      }
      const records = buckets[bucket];
      let record = records.get(userId);
      if (!record || record.resetAt <= time) {
        record = { count: 0, resetAt: time + WINDOW_MS };
        records.set(userId, record);
      }
      if (record.count >= limits[bucket]) return { retryAfter: Math.ceil((record.resetAt - time) / 1000) };
      record.count++;
    },
  };
}

export function rateLimitError() {
  return new BrokerError("rate_limited", "Demasiadas solicitudes. Intenta de nuevo en un minuto.");
}
