# Nexo Admin

Panel y MCP de administración de Nexo. Diseño, contrato e issues: [docs/admin.md](../../docs/admin.md). Instrucciones para agentes: [AGENTS.md](AGENTS.md).

## MCP de administración

El servidor admin expone en `POST $ADMIN_URL/mcp` un MCP de **solo lectura** para depurar producción desde Claude Code o Codex. Usa Streamable HTTP sin estado. Cada solicitud debe incluir `Authorization: Bearer nxa_…`.

- Todos los datos ya vienen redactados. Nunca hay payloads (`args`, `result` ni propósito), tokens, nonces ni texto libre de terceros.
- El MCP no ejecuta acciones. Reintentar, expirar o revocar se hace desde el panel.
- Cada `tools/call` queda en la bitácora de auditoría (`mcp:<tool>`) con el token que la hizo.
- Límite: 60 solicitudes por minuto por token. Al superarlo responde `429` con `Retry-After`.

### 1. Crear un token

1. Entra al panel (`$ADMIN_URL`) con una cuenta de `ADMIN_OPERATORS`. Solo los operadores crean tokens y la sesión debe tener menos de 10 minutos. Si es más antigua, vuelve a entrar.
2. Abre **Tokens MCP → Crear token**. Ponle un nombre que identifique a quien lo usa (por ejemplo «claude-simon»), elige la duración (1 a 30 días, 7 por defecto) y los scopes:
   - `admin:read`: todas las tools de lectura.
   - `admin:sql`: además permite `admin_sql` (un `SELECT` libre sobre las vistas `ops.v_*`). Este scope incluye la lectura.
3. Copia el token `nxa_…`. Se muestra **una sola vez** porque el servidor solo guarda su hash. Revócalo en la misma pantalla cuando ya no lo necesites.

Guárdalo en una variable de entorno, nunca en el repo:

```bash
export ADMIN_URL="https://admin.example.com"   # en local: http://127.0.0.1:$ADMIN_PORT
export NEXO_ADMIN_TOKEN="nxa_..."
```

### 2. Conectar Claude Code

```bash
claude mcp add --transport http nexo-admin "$ADMIN_URL/mcp" --header "Authorization: Bearer $NEXO_ADMIN_TOKEN"
```

Verifica con `claude mcp list` o con `/mcp` dentro de una sesión. Agrega `--scope user` para usarlo en todos tus proyectos. El valor por defecto (`local`) lo deja solo en el proyecto actual.

### 3. Conectar Codex

Codex lee el token desde una variable de entorno en cada conexión. Así el token nunca queda escrito en `~/.codex/config.toml`:

```bash
codex mcp add nexo-admin --url "$ADMIN_URL/mcp" --bearer-token-env-var NEXO_ADMIN_TOKEN
```

`NEXO_ADMIN_TOKEN` debe estar exportada en la terminal donde abres `codex`.

### Tools

Todas tienen `readOnlyHint: true`. Devuelven `structuredContent`, validado con los esquemas de `shared/contract.ts`, y un resumen corto en texto. Si algo no existe, responden con `isError: true` y un mensaje claro.

| Tool | Argumentos | Para qué |
| --- | --- | --- |
| `admin_overview` | `window` (`15m`·`1h`·`24h`·`7d`, por defecto `1h`) | Empieza aquí: qué está roto ahora |
| `admin_services` | – | Latidos por servicio e instancia |
| `admin_search_requests` | `status[]`, `tool`, `address`, `q`, `stuck`, `since`, `until`, `cursor`, `limit` | Encontrar solicitudes |
| `admin_get_request` | `request_id` | Línea de tiempo, avisos, política y trazas |
| `admin_get_trace` | `trace_id` | Spans entre servicios |
| `admin_events` | `service`, `kind`, `name`, `level`, `request_id`, `user_id`, `trace_id`, `after_id`, `before_id`, `limit` | Historial de telemetría |
| `admin_errors` | `window` (por defecto `24h`), `service`, `operation` | Errores agrupados |
| `admin_get_error` | `error_id` | Un error por su `X-Error-Id` |
| `admin_search_users` | `q`, `cursor`, `limit` | Buscar personas |
| `admin_get_user` | `id_or_address` | Persona, OAuth, reglas, agentes y solicitudes recientes |
| `admin_agents` | `failing`, `kind` | Conexiones con avisos fallando |
| `admin_wake_queue` | `state` (`queued`·`running`·`done`) | Cola de avisos |
| `admin_sql` | `sql` (exige `admin:sql`) | Un `SELECT`/`WITH` sobre `ops.v_*`, con 3 s y 200 filas como máximo |

El recurso `admin://schema` lista las vistas `ops.v_*` con sus columnas, obtenidas de `information_schema`, y el catálogo de eventos de telemetría.

Flujo sugerido: `admin_overview` → `admin_search_requests` (por ejemplo `stuck: true`) → `admin_get_request` → `admin_get_trace` con uno de sus `traceIds`.

### Probar en local

El código vive en `server/mcp/` y la ruta la monta el servidor admin con `mountAdminMcp(app, deps)`. Las pruebas usan el cliente MCP del SDK contra una app Hono en memoria y un `AdminQueries` falso, sin Postgres:

```bash
pnpm --filter @team-31/admin test
```
