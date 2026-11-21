import { createHash, randomBytes } from "node:crypto"
import type pg from "pg"
import { z } from "zod"
import { ADMIN_TOKEN_PREFIX, AdminToken, AdminTokenScope, CreateAdminToken } from "../shared/contract.js"
import type { TokenPrincipal } from "./mcp/types.js"

// Tokens personales sba_ para el MCP de administración. Solo se guarda sha256(token).
// Ver docs/admin.md#4-sesiones-y-acceso.

const PREFIX_LENGTH = 12
const TOUCH_INTERVAL_MS = 60_000
const DAY_MS = 86_400_000

type TokenRow = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  created_by: string
  created_at: Date
  expires_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

export interface TokenStore {
  create(input: z.input<typeof CreateAdminToken>, createdBy: string): Promise<{ token: string; meta: AdminToken }>
  list(): Promise<AdminToken[]>
  // false si no existe o ya estaba revocado.
  revoke(id: string): Promise<boolean>
  // null si el token no existe, venció o fue revocado. Acepta el token con o sin "Bearer ".
  authenticate(bearer: string): Promise<TokenPrincipal | null>
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

const iso = (value: Date | null) => (value ? value.toISOString() : null)

function toAdminToken(row: TokenRow): AdminToken {
  return AdminToken.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
  })
}

const COLUMNS = "id, name, prefix, scopes, created_by, created_at, expires_at, last_used_at, revoked_at"
const Uuid = z.uuid()

export function createPgTokenStore(pool: pg.Pool, now: () => number = Date.now): TokenStore {
  return {
    async create(input, createdBy) {
      const { name, ttlDays, scopes } = CreateAdminToken.parse(input)
      const token = `${ADMIN_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
      const { rows } = await pool.query<TokenRow>(
        `INSERT INTO admin.tokens (name, token_hash, prefix, scopes, created_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [name, hashToken(token), token.slice(0, PREFIX_LENGTH), [...new Set(scopes)], createdBy, new Date(now()), new Date(now() + ttlDays * DAY_MS)],
      )
      return { token, meta: toAdminToken(rows[0]!) }
    },

    async list() {
      const { rows } = await pool.query<TokenRow>(`SELECT ${COLUMNS} FROM admin.tokens ORDER BY created_at DESC, id`)
      return rows.map(toAdminToken)
    },

    async revoke(id) {
      if (!Uuid.safeParse(id).success) return false
      const { rowCount } = await pool.query(
        "UPDATE admin.tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
        [id, new Date(now())],
      )
      return rowCount === 1
    },

    async authenticate(bearer) {
      const token = bearer.replace(/^Bearer\s+/i, "").trim()
      if (!token.startsWith(ADMIN_TOKEN_PREFIX) || token.length > 100) return null
      const at = new Date(now())
      const { rows } = await pool.query<TokenRow>(
        `SELECT ${COLUMNS} FROM admin.tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
        [hashToken(token), at],
      )
      const row = rows[0]
      if (!row) return null
      // last_used_at como máximo una vez por minuto para no escribir en cada llamada.
      if (!row.last_used_at || at.getTime() - row.last_used_at.getTime() >= TOUCH_INTERVAL_MS) {
        await pool.query("UPDATE admin.tokens SET last_used_at = $2 WHERE id = $1", [row.id, at])
      }
      const scopes = row.scopes.flatMap((scope) => {
        const parsed = AdminTokenScope.safeParse(scope)
        return parsed.success ? [parsed.data] : []
      })
      return { tokenId: row.id, label: row.name, createdBy: row.created_by, scopes }
    },
  }
}
