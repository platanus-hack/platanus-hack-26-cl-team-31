// Límite en memoria de ventana fija: `limit` solicitudes por `windowMs` por clave (tokenId).
// Basta para una sola instancia del servidor admin (docs/admin.md: 60 req/min por token).
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>()

  function prune(at: number) {
    for (const [key, window] of windows) if (at - window.start >= windowMs) windows.delete(key)
  }

  return function hit(key: string): RateLimitResult {
    const at = now()
    if (windows.size > 1000) prune(at)
    const current = windows.get(key)
    if (!current || at - current.start >= windowMs) {
      windows.set(key, { start: at, count: 1 })
      return { ok: true }
    }
    if (current.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((current.start + windowMs - at) / 1000)) }
    }
    current.count += 1
    return { ok: true }
  }
}
