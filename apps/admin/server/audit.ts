import type { Telemetry } from "@team-31/telemetry"
import type pg from "pg"

// Bitácora de acciones del admin (admin.audit) y migración de las tablas propias del
// servidor admin (admin.tokens y admin.audit). Ver docs/admin.md#4-sesiones-y-acceso.

export type AuditActor = { type: "admin" | "token"; id: string; label: string }

export type AuditInput = {
  actor: AuditActor
  // reveal, rewake, expire, revoke-agent, sql, login, token.create, token.revoke, mcp.call…
  action: string
  target: string | null
  reason?: string | null
  ip?: string | null
  // Solo escalares de control (ok, código). Nunca payloads, tokens ni texto libre de terceros.
  meta?: Record<string, string | number | boolean | null>
}

export interface AuditLog {
  // Devuelve el id de la fila de auditoría.
  record(entry: AuditInput): Promise<string>
  complete(id: string, meta: Record<string, string | number | boolean | null>): Promise<void>
}

// Evento admin.* del catálogo de @team-31/telemetry que acompaña a cada fila.
function eventOf(action: string) {
  if (action === "login") return "admin.login" as const
  if (action === "logout") return "admin.logout" as const
  if (action === "reveal") return "admin.reveal" as const
  if (action === "token.create") return "admin.token.created" as const
  if (action === "token.revoke") return "admin.token.revoked" as const
  if (action.startsWith("mcp:")) return "admin.mcp.call" as const
  return "admin.action" as const
}

export function createPgAuditLog(pool: pg.Pool, telemetry: Pick<Telemetry, "emit">): AuditLog {
  return {
    async complete(id, meta) {
      await pool.query("UPDATE admin.audit SET meta = $2 WHERE id = $1", [id, JSON.stringify(meta)])
    },
    async record({ actor, action, target, reason = null, ip = null, meta = {} }) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO admin.audit (actor_type, actor_id, actor_label, action, target, reason, ip, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [actor.type, actor.id, actor.label, action, target, reason, ip, JSON.stringify(meta)],
      )
      // Sin motivo, ip ni correo: solo la acción y su objetivo.
      const event = eventOf(action)
      telemetry.emit(event, {
        requestId: action === "reveal" || action === "rewake" || action === "expire" ? target : null,
        attrs: {
          action,
          ...(target ? { target } : {}),
          ...(event === "admin.mcp.call" ? { tool: action.slice("mcp:".length) } : {}),
        },
      })
      return rows[0]!.id
    },
  }
}

const LOCK = "hashtext('sideband:admin:migrations')"

// Esquema y tablas propias del servidor admin. Idempotente y serializada con un candado
// consultivo para que varias instancias (o suites de prueba) puedan correrla a la vez.
export async function migrateAdminTables(pool: pg.Pool): Promise<void> {
  // Un único mensaje SQL ejecuta el candado y el DDL en la misma transacción implícita.
  await pool.query(`
    SELECT pg_advisory_xact_lock(${LOCK});
    CREATE SCHEMA IF NOT EXISTS admin;

    CREATE TABLE IF NOT EXISTS admin.tokens (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name         text NOT NULL,
      token_hash   text NOT NULL UNIQUE,
      prefix       text NOT NULL,
      scopes       text[] NOT NULL,
      created_by   text NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      expires_at   timestamptz NOT NULL,
      last_used_at timestamptz,
      revoked_at   timestamptz
    );

    CREATE TABLE IF NOT EXISTS admin.audit (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      at          timestamptz NOT NULL DEFAULT clock_timestamp(),
      actor_type  text NOT NULL CHECK (actor_type IN ('admin', 'token')),
      actor_id    text NOT NULL,
      actor_label text NOT NULL,
      action      text NOT NULL,
      target      text,
      reason      text,
      ip          text,
      meta        jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS audit_at_idx ON admin.audit (at DESC, id DESC);

    -- AdminQueries.audit() (ADM-02) lee la bitácora con el rol de solo lectura.
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sideband_admin_ro') THEN
        GRANT USAGE ON SCHEMA admin TO sideband_admin_ro;
        GRANT SELECT ON admin.audit TO sideband_admin_ro;
      END IF;
    END $$;
  `)
}
