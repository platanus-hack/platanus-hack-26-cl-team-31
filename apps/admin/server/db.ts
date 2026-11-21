import pg from "pg"

// Pool del esquema `admin` (Better Auth, tokens sba_ y auditoría). El search_path hace que
// Better Auth cree y lea sus tablas en `admin` sin tocar las de apps/web en `public`.
export function createAdminPool(databaseUrl: string, max = 5): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=admin", max })
}
