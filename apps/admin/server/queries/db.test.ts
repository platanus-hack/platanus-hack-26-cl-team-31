import type { Pool } from "pg"
import { expect, it, vi } from "vitest"
import { readOnly } from "./db.js"

function readPool() {
  const client = { query: vi.fn(), release: vi.fn() }
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ ok: true }] }),
    connect: vi.fn().mockResolvedValue(client),
  }
  return { client, pool: pool as unknown as Pool }
}

it("discards a connection if read-only transaction setup fails", async () => {
  const { client, pool } = readPool()
  const failure = new Error("setup failed")
  client.query.mockRejectedValueOnce(failure)
  const read = vi.fn()
  await expect(readOnly(pool, "sideband_admin_ro", read)).rejects.toBe(failure)
  expect(read).not.toHaveBeenCalled()
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true)
})

it.each([true, false])("reuses a failed read's connection only if rollback succeeded (%s)", async (rollbackOk) => {
  const { client, pool } = readPool()
  client.query.mockResolvedValueOnce(undefined)
  if (rollbackOk) client.query.mockResolvedValueOnce(undefined)
  else client.query.mockRejectedValueOnce(new Error("rollback failed"))
  const failure = new Error("read failed")
  await expect(readOnly(pool, "sideband_admin_ro", async () => { throw failure })).rejects.toBe(failure)
  expect(client.query).toHaveBeenLastCalledWith("ROLLBACK")
  expect(client.release).toHaveBeenCalledExactlyOnceWith(!rollbackOk)
})
