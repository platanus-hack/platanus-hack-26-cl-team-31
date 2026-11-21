// STUB del contrato. Lo implementa ADM-02 (docs/admin.md): AdminQueries sobre las vistas
// ops.v_*, siempre dentro de `BEGIN READ ONLY; SET LOCAL ROLE nexo_admin_ro`.
import type { AdminQueries } from "../../shared/queries.js"

export type PgAdminQueriesOptions = { databaseUrl: string }

export function createPgAdminQueries(_options: PgAdminQueriesOptions): AdminQueries {
  throw new Error("createPgAdminQueries aún no está implementado (ADM-02).")
}
