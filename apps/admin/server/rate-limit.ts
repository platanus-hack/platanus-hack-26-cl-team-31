import { createRateLimiter, type RateLimiter } from "@team-31/auth/rate-limit"

export type AdminLimiters = { reveal: RateLimiter; login: RateLimiter }

// reveal: 10 por hora por admin; login: 10 por minuto por IP (docs/admin.md#4).
export function createAdminLimiters(now: () => number = Date.now): AdminLimiters {
  return {
    reveal: createRateLimiter({ limit: 10, windowMs: 3_600_000, now }),
    login: createRateLimiter({ limit: 10, windowMs: 60_000, now }),
  }
}
