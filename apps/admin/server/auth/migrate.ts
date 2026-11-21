// pnpm with-env pnpm --filter @team-31/admin admin:auth:migrate
// Crea el esquema `admin`, las tablas de Better Auth del admin y admin.tokens/admin.audit.
import { migrateAdminTables } from "../audit.js"
import { createAdminPool } from "../db.js"
import { allowListFromEnv, readEnv } from "../env.js"
import { createRoleResolver, migrateAdminAuth } from "./index.js"

const env = readEnv(process.env)
const pool = createAdminPool(env.databaseUrl, 1)
try {
  await migrateAdminTables(pool)
  await migrateAdminAuth({
    pool,
    baseUrl: env.adminUrl,
    secret: env.authSecret,
    google: env.google,
    roleOf: createRoleResolver(allowListFromEnv(process.env), { devAuth: env.devAuth }),
    freshSeconds: env.freshSeconds,
  })
  console.info("[admin] Esquema admin actualizado.")
} finally {
  await pool.end()
}
