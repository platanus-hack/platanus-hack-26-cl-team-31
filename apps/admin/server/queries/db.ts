// Conexión de solo lectura a las vistas ops.v_*. Toda consulta corre dentro de
// `BEGIN READ ONLY; SET LOCAL ROLE <rol>; SET LOCAL statement_timeout = '3s'`: el rol solo
// puede leer las vistas redactadas (packages/ops/sql/0003_roles.sql), nunca las tablas.
import pg from "pg"

import { AdminQueryError } from "../../shared/queries.js"

export type ReadRole = "sideband_admin_ro" | "sideband_admin_reveal"
export type Db = pg.PoolClient

export const STATEMENT_TIMEOUT = "3s"

export function createPool(databaseUrl: string): pg.Pool {
  if (!databaseUrl)
    throw new Error("databaseUrl es obligatoria para las consultas del admin.")
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })
  // pg descarta los clientes inactivos que fallan; el siguiente checkout reconecta.
  pool.on("error", () => {})
  return pool
}

// ¿Puede el usuario de conexión asumir el rol? En Postgres administrado (Render) el usuario no es
// superusuario: si la migración 0008 no pudo darle la membresía WITH SET, el admin corre en modo
// degradado (sin SET ROLE). Las lecturas siguen en READ ONLY y solo tocan vistas redactadas, pero
// sql() se deshabilita porque sin el rol podría leer tablas base. Se calcula una vez por pool.
const roleChecks = new WeakMap<pg.Pool, Map<ReadRole, Promise<boolean>>>()

export function canAssumeRole(pool: pg.Pool, role: ReadRole): Promise<boolean> {
  let checks = roleChecks.get(pool)
  if (!checks) {
    checks = new Map()
    roleChecks.set(pool, checks)
  }
  let check = checks.get(role)
  if (!check) {
    check = pool
      .query<{ ok: boolean | null }>(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
                THEN pg_has_role(current_user, $1, 'SET') ELSE false END AS ok`,
        [role]
      )
      .then(({ rows }) => rows[0]?.ok === true)
    // Un fallo transitorio de conexión no deja fijado el modo degradado.
    check.catch(() => checks.delete(role))
    checks.set(role, check)
  }
  return check
}

// Los nombres de rol son constantes del código, nunca entrada del usuario.
export async function readOnly<T>(
  pool: pg.Pool,
  role: ReadRole,
  fn: (db: Db) => Promise<T>
): Promise<T> {
  const setRole = (await canAssumeRole(pool, role)) ? ` SET LOCAL ROLE ${role};` : ""
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query(
      `BEGIN READ ONLY;${setRole} SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`
    )
    try {
      const result = await fn(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        broken = rollbackError
      })
      throw error
    }
  } catch (error) {
    throw mapPgError(error)
  } finally {
    client.release(broken)
  }
}

type PgError = Error & { code?: string }

export function mapPgError(error: unknown): unknown {
  if (error instanceof AdminQueryError) return error
  const code = (error as PgError | undefined)?.code
  if (code === "57014")
    return new AdminQueryError(
      "timeout",
      `La consulta superó ${STATEMENT_TIMEOUT}.`
    )
  return error
}

// ---------- Conversión de filas ----------

export function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function isoOrNull(
  value: Date | string | null | undefined
): string | null {
  return value === null || value === undefined ? null : iso(value)
}

// pg devuelve bigint y numeric como string.
export function num(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value)
}

export function numOrNull(
  value: number | string | null | undefined
): number | null {
  return value === null || value === undefined ? null : Number(value)
}

type Scalar = string | number | boolean | null

// attrs ya viene validado por el catálogo de telemetría. Por si acaso, todo lo que no sea escalar
// se serializa para cumplir el contrato (Record<string, Scalar>).
export function scalarAttrs(value: unknown): Record<string, Scalar> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      item === null || ["string", "number", "boolean"].includes(typeof item)
        ? (item as Scalar)
        : JSON.stringify(item),
    ])
  )
}

// ---------- Cursores ----------
// Opacos para el cliente: base64url de [valor de orden en texto de Postgres, id]. El texto de
// Postgres conserva los microsegundos, así el keyset no salta ni repite filas.

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id]), "utf8").toString("base64url")
}

export function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    )
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === "string")
    ) {
      return [value[0] as string, value[1] as string]
    }
  } catch {
    // cae al error de abajo
  }
  throw new AdminQueryError("invalid_input", "Cursor inválido.")
}

// Para LIKE con prefijo: escapa los comodines del usuario.
export function likePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`) + "%"
}

export function likeContains(value: string): string {
  return "%" + likePrefix(value)
}

// Construye un WHERE con parámetros posicionales: `where.and(\`x = ${where.value(x)}\`)`.
export class Where {
  readonly params: unknown[] = []
  private readonly clauses: string[] = []

  // Agrega un valor y devuelve su placeholder ($n).
  value(value: unknown): string {
    this.params.push(value)
    return `$${this.params.length}`
  }

  and(clause: string): this {
    this.clauses.push(clause)
    return this
  }

  toString(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(" AND ")}` : ""
  }
}
