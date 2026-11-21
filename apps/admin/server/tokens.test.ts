import { createTestDatabase, ignoreTerminationAfterEnd, type TestDatabase } from "@team-31/test-db"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migrateAdminTables } from "./audit.js"
import { createAdminPool } from "./db.js"
import { TEST_DATABASE_URL } from "./test-support.js"
import { createPgTokenStore, hashToken } from "./tokens.js"

const DAY = 86_400_000

describe.skipIf(!TEST_DATABASE_URL)("tokens sba_ (Postgres)", () => {
  let pool: pg.Pool
  let testDb: TestDatabase | undefined

  beforeAll(async () => {
    // Base propia: better-auth inspecciona todos los esquemas, y otros paquetes crean y borran
    // los suyos en app_test en paralelo.
    testDb = await createTestDatabase("admin_tokens")
    pool = ignoreTerminationAfterEnd(createAdminPool(testDb.url))
    await migrateAdminTables(pool)
    await pool.query("DELETE FROM admin.tokens")
  })
  afterAll(async () => {
    await pool?.end()
    await testDb?.drop()
  })

  it("crea un token sba_ de 32 bytes, guarda solo sha256 y lo autentica", async () => {
    const tokens = createPgTokenStore(pool)
    const { token, meta } = await tokens.create({ name: "claude local", ttlDays: 7, scopes: ["admin:read", "admin:sql"] }, "op@test.cl")

    expect(token).toMatch(/^sba_[A-Za-z0-9_-]{43}$/)
    expect(meta.prefix).toBe(token.slice(0, 12))
    expect(new Date(meta.expiresAt).getTime() - new Date(meta.createdAt).getTime()).toBe(7 * DAY)
    const { rows } = await pool.query("SELECT token_hash FROM admin.tokens WHERE id = $1", [meta.id])
    expect(rows[0].token_hash).toBe(hashToken(token))
    expect(JSON.stringify(rows)).not.toContain(token)

    await expect(tokens.authenticate(`Bearer ${token}`)).resolves.toEqual({
      tokenId: meta.id,
      label: "claude local",
      createdBy: "op@test.cl",
      scopes: ["admin:read", "admin:sql"],
    })
  })

  it("rechaza TTL fuera de 1 a 30 días", async () => {
    const tokens = createPgTokenStore(pool)
    await expect(tokens.create({ name: "largo", ttlDays: 31 }, "op@test.cl")).rejects.toThrow()
    await expect(tokens.create({ name: "corto", ttlDays: 0 }, "op@test.cl")).rejects.toThrow()
  })

  it("rechaza tokens revocados, vencidos, desconocidos o sin prefijo", async () => {
    let clock = Date.now()
    const tokens = createPgTokenStore(pool, () => clock)
    const revoked = await tokens.create({ name: "revocado", ttlDays: 1 }, "op@test.cl")
    const expiring = await tokens.create({ name: "vence", ttlDays: 1 }, "op@test.cl")

    expect(await tokens.revoke(revoked.meta.id)).toBe(true)
    expect(await tokens.revoke(revoked.meta.id)).toBe(false)
    expect(await tokens.revoke("no-es-uuid")).toBe(false)
    await expect(tokens.authenticate(revoked.token)).resolves.toBeNull()

    await expect(tokens.authenticate(expiring.token)).resolves.not.toBeNull()
    clock += DAY + 1
    await expect(tokens.authenticate(expiring.token)).resolves.toBeNull()

    await expect(tokens.authenticate("sba_desconocido")).resolves.toBeNull()
    await expect(tokens.authenticate(expiring.token.slice(4))).resolves.toBeNull()
  })

  it("actualiza last_used_at como máximo una vez por minuto", async () => {
    let clock = Date.now()
    const tokens = createPgTokenStore(pool, () => clock)
    const { token, meta } = await tokens.create({ name: "uso", ttlDays: 1 }, "op@test.cl")
    const lastUsed = async () =>
      (await pool.query<{ last_used_at: Date | null }>("SELECT last_used_at FROM admin.tokens WHERE id = $1", [meta.id])).rows[0]!.last_used_at?.getTime()

    await tokens.authenticate(token)
    const first = await lastUsed()
    expect(first).toBe(clock)

    clock += 30_000
    await tokens.authenticate(token)
    expect(await lastUsed()).toBe(first)

    clock += 30_000
    await tokens.authenticate(token)
    expect(await lastUsed()).toBe(clock)
  })
})
