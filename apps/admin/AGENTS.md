# apps/admin

Panel y MCP de administración de Nexo. Diseño completo e issues: [docs/admin.md](../../docs/admin.md).

| Carpeta | Qué hay | Reglas |
| --- | --- | --- |
| `shared/` | `contract.ts` (tipos y `adminRoutes`) y `queries.ts` (`AdminQueries`) | Es el contrato entre SPA, API y MCP. Cambiarlo exige actualizar `docs/admin.md`. Imports relativos con `.js`. |
| `server/` | Servidor Hono: auth y sesiones, API `/api/admin/*`, MCP `/mcp`, tokens `nxa_` y auditoría | Las lecturas pasan solo por `AdminQueries`. Las escrituras de dominio van al `AdminPort` del broker. Nunca devuelvas payloads salvo en reveal. |
| `server/queries/` | `createPgAdminQueries` sobre vistas `ops.v_*` | Siempre en `READ ONLY` y con `SET LOCAL ROLE nexo_admin_ro`. |
| `server/mcp/` | `mountAdminMcp` | Solo lectura. Todas las tools con `readOnlyHint: true`. |
| `src/` | SPA React 19 + shadcn | Usa la skill `shadcn`. Agrega componentes con `pnpm dlx shadcn@latest add <x>` desde esta carpeta. Colores solo con tokens semánticos. Valida respuestas con los esquemas de `@shared/contract`. |

Comandos: `pnpm dev --filter @team-31/admin` · `pnpm --filter @team-31/admin build|lint|typecheck|test`.
