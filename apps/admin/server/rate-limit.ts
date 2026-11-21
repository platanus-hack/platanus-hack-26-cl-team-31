// Ventana fija en memoria (una instancia del admin). Mismo patrón que apps/broker/src/http/rate-limit.ts.
export interface RateLimiter {
  // undefined si se permite; si no, los segundos hasta poder reintentar.
  consume(key: string): { retryAfter: number } | undefined
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const records = new Map<string, { count: number; resetAt: number }>()
  let nextCleanup = 0
  return {
    consume(key) {
      const time = now()
      if (time >= nextCleanup) {
        for (const [id, record] of records) if (record.resetAt <= time) records.delete(id)
        nextCleanup = time + windowMs
      }
      let record = records.get(key)
      if (!record || record.resetAt <= time) {
        record = { count: 0, resetAt: time + windowMs }
        records.set(key, record)
      }
      if (record.count >= limit) return { retryAfter: Math.max(1, Math.ceil((record.resetAt - time) / 1000)) }
      record.count++
      return undefined
    },
  }
}

export type AdminLimiters = { reveal: RateLimiter; login: RateLimiter }

// reveal: 10 por hora por admin; login: 10 por minuto por IP (docs/admin.md#4).
export function createAdminLimiters(now: () => number = Date.now): AdminLimiters {
  return {
    reveal: createRateLimiter({ limit: 10, windowMs: 3_600_000, now }),
    login: createRateLimiter({ limit: 10, windowMs: 60_000, now }),
  }
}
