import { describe, expect, it } from "vitest"
import { createRoleResolver } from "./auth/index.js"
import { allowListFromEnv, readEnv } from "./env.js"

const base = {
  ADMIN_URL: "http://127.0.0.1:4400/",
  ADMIN_PORT: "4400",
  ADMIN_API_PORT: "4450",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:54320/app",
  BETTER_AUTH_SECRET: "dev-secret",
}

describe("readEnv", () => {
  it("usa ADMIN_API_PORT en dev y ADMIN_PORT al servir la SPA", () => {
    expect(readEnv(base)).toMatchObject({ port: 4450, serveSpa: false, adminUrl: "http://127.0.0.1:4400" })
    expect(readEnv({ ...base, ADMIN_SERVE_SPA: "1" })).toMatchObject({ port: 4400, serveSpa: true })
  })

  it("deriva un secreto propio fuera de producción y lo exige en producción", () => {
    const env = readEnv(base)
    expect(env.authSecret).not.toBe("dev-secret")
    expect(env.authSecret.length).toBeGreaterThanOrEqual(32)
    expect(() => readEnv({ ...base, NODE_ENV: "production" })).toThrow(/ADMIN_AUTH_SECRET/)
    expect(readEnv({ ...base, NODE_ENV: "production", ADMIN_AUTH_SECRET: "s".repeat(32) }).authSecret).toBe("s".repeat(32))
  })

  it("prohíbe ADMIN_DEV_AUTH en producción", () => {
    expect(readEnv({ ...base, ADMIN_DEV_AUTH: "1" }).devAuth).toBe(true)
    expect(() => readEnv({ ...base, NODE_ENV: "production", ADMIN_AUTH_SECRET: "s".repeat(32), ADMIN_DEV_AUTH: "1" })).toThrow(/ADMIN_DEV_AUTH/)
  })

  it("usa DATABASE_URL como respaldo de las URLs del admin", () => {
    expect(readEnv(base)).toMatchObject({ databaseUrl: base.DATABASE_URL, readOnlyDatabaseUrl: base.DATABASE_URL })
    const ro = "postgresql://ro:ro@db:5432/app"
    expect(readEnv({ ...base, ADMIN_DATABASE_URL_RO: ro }).readOnlyDatabaseUrl).toBe(ro)
  })

  it("exige ambas credenciales de Google juntas", () => {
    expect(() => readEnv({ ...base, ADMIN_GOOGLE_CLIENT_ID: "id" })).toThrow(/ADMIN_GOOGLE_CLIENT_SECRET/)
    expect(readEnv({ ...base, ADMIN_GOOGLE_CLIENT_ID: "id", ADMIN_GOOGLE_CLIENT_SECRET: "s" }).google).toEqual({ clientId: "id", clientSecret: "s" })
  })
})

describe("roles", () => {
  it("lee la lista blanca en cada llamada y normaliza los correos", () => {
    const source: NodeJS.ProcessEnv = { ADMIN_OPERATORS: " Op@Test.cl ", ADMIN_VIEWERS: "v@test.cl,w@test.cl" }
    const roleOf = createRoleResolver(allowListFromEnv(source), { devAuth: false })
    expect(roleOf("op@test.cl")).toBe("operator")
    expect(roleOf("W@test.cl")).toBe("viewer")
    expect(roleOf("dev@nexo.local")).toBeNull()
    source.ADMIN_VIEWERS = "v@test.cl"
    expect(roleOf("w@test.cl")).toBeNull()
    expect(createRoleResolver(allowListFromEnv(source), { devAuth: true })("dev@nexo.local")).toBe("operator")
  })
})
