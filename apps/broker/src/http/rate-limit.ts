import { createRateLimiter } from "@team-31/auth/rate-limit";
import { BrokerError } from "@team-31/broker";

type Bucket = "ask" | "reply" | "vault" | "other";
const limits = { ask: 30, reply: 120, vault: 10, other: 300 };

export interface RateLimiter {
  consume(userId: string, bucket: Bucket): Promise<{ retryAfter: number } | undefined>;
}

export function createMemoryRateLimiter(now = Date.now): RateLimiter {
  const perMinute = (limit: number) => createRateLimiter({ limit, windowMs: 60_000, now });
  const buckets = {
    ask: perMinute(limits.ask), reply: perMinute(limits.reply), vault: perMinute(limits.vault), other: perMinute(limits.other),
  };
  return {
    async consume(userId, bucket) {
      return buckets[bucket].consume(userId);
    },
  };
}

export function createSharedRateLimiter(store: import("@team-31/broker/postgres").PostgresStore): RateLimiter {
  return { consume: (userId, bucket) => store.consumeQuota(userId, bucket, limits[bucket]) };
}

export function rateLimitError() {
  return new BrokerError("rate_limited", "Demasiadas solicitudes. Intenta de nuevo en un minuto.");
}
