import type { Pool } from "pg"
import { afterEach, expect, it, vi } from "vitest"
import { startPruneTask } from "./prune.js"

afterEach(() => vi.useRealTimers())

it("runs retention once at a time and waits for the pending deletion on shutdown", async () => {
  vi.useFakeTimers()
  const pending = Promise.withResolvers<void>()
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ ready: true }] }).mockReturnValueOnce(pending.promise)
  const stop = startPruneTask({ query } as unknown as Pool, 7, { error: vi.fn() }, { initialDelayMs: 1, intervalMs: 10 })
  await vi.advanceTimersByTimeAsync(30)
  expect(query).toHaveBeenCalledTimes(2)
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("ops.prune_events"), [7])
  const stopped = vi.fn()
  const done = stop().then(stopped)
  await vi.advanceTimersByTimeAsync(40)
  expect(stopped).not.toHaveBeenCalled()
  pending.resolve()
  await done
  expect(query).toHaveBeenCalledTimes(2)
})
