import { createRateLimiter } from "@team-31/auth/rate-limit";
import { BrokerError } from "@team-31/broker";

type Bucket = "ask" | "reply" | "other";

export interface RateLimiter {
  consume(userId: string, bucket: Bucket): Promise<{ retryAfter: number } | undefined>;
}

export function createMemoryRateLimiter(now = Date.now): RateLimiter {
  const perMinute = (limit: number) => createRateLimiter({ limit, windowMs: 60_000, now });
  const buckets = { ask: perMinute(30), reply: perMinute(120), other: perMinute(300) };
  return {
    async consume(userId, bucket) {
      return buckets[bucket].consume(userId);
    },
  };
}

export function rateLimitError() {
  return new BrokerError("rate_limited", "Demasiadas solicitudes. Intenta de nuevo en un minuto.");
}
