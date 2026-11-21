export interface RateLimiter {
  /** Undefined when allowed; otherwise the remaining window in whole seconds (rounded up). */
  consume(key: string): { retryAfter: number } | undefined;
}

/** One fixed window per key, starting on its first request. State is local to this instance. */
export function createRateLimiter({ limit, windowMs, now = Date.now }: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextCleanup = 0;
  return {
    consume(key) {
      const time = now();
      if (time >= nextCleanup) {
        for (const [id, window] of windows) if (window.resetAt <= time) windows.delete(id);
        nextCleanup = time + windowMs;
      }
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }
      if (window.count >= limit) return { retryAfter: Math.ceil((window.resetAt - time) / 1000) };
      window.count++;
    },
  };
}
