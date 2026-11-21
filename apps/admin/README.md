# Sideband Admin

Panel y MCP de administración de Sideband. Diseño, contrato e issues: [docs/admin.md](../../docs/admin.md). Instrucciones para agentes: [AGENTS.md](AGENTS.md).

## Servidor admin (`server/`)

Servidor Hono con Better Auth propio (esquema `admin`, cookie `sideband-admin.session_token`), la API `/api/admin/*` generada desde `adminRoutes`, el MCP `/mcp`, tokens `sba_`, auditoría en `admin.audit` y `GET /healthz`. Emite telemetría como servicio `admin` (`service.started`, latido, `http.request` y un evento `admin.*` por cada fila de auditoría).

### Levantarlo en local

```bash
pnpm bootstrap                                   # Postgres, llaves (incluida ADMIN_SERVICE_PRIVATE_KEY)
pnpm --filter @team-31/ops build && pnpm with-env pnpm --filter @team-31/ops migrate   # ops.events (telemetría)
pnpm dev --filter @team-31/admin                 # Vite en ADMIN_PORT + tsx watch en ADMIN_API_PORT
```

Abre `$ADMIN_URL` (`cat .env`). Vite reenvía `/api` y `/mcp` al servidor. En dev el servidor crea el esquema `admin` y sus tablas al arrancar. En producción ejecuta antes `pnpm with-env pnpm --filter @team-31/admin admin:auth:migrate` (o `node dist/server/server/auth/migrate.js`).

Variables en `.env.local` (ver `.env.local.example`):

| Variable | Para qué |
| --- | --- |
| `ADMIN_OPERATORS` / `ADMIN_VIEWERS` | Correos separados por coma. El rol se recalcula en cada request: quitar un correo revoca el acceso en el siguiente. Un correo fuera de la lista recibe 403 y no se crea su usuario. |
| `ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_GOOGLE_CLIENT_SECRET` | Login con Google. Redirect URI: `$ADMIN_URL/api/auth/callback/google`. |
| `ADMIN_DEV_AUTH=1` | Habilita `POST /api/admin/dev-login` (sesión de `dev@sideband.local` como operator). Prohibido con `NODE_ENV=production`. |
| `ADMIN_AUTH_SECRET` | Secreto de Better Auth (32+ caracteres). Obligatorio en producción. En dev se deriva de `BETTER_AUTH_SECRET`. |
| `ADMIN_FRESH_SECONDS` | Ventana de sesión fresca para acciones sensibles (600 por defecto). |
| `ADMIN_SERVICE_PRIVATE_KEY` + `BROKER_URL` | Acciones en el broker (`rewake`, `expire`, `revokeAgent`) con JWT `iss=admin`. |
| `ADMIN_DATABASE_URL` / `ADMIN_DATABASE_URL_RO` | Producción: esquema `admin` + reveal / lecturas `sideband_admin_ro`. Si faltan, `DATABASE_URL`. |
| `ADMIN_SERVE_SPA=1`, `ADMIN_HOST`, `ADMIN_TRUST_PROXY` | Producción: un solo proceso en `ADMIN_PORT`; `0.0.0.0` en contenedores; IP real desde `X-Forwarded-For`. |
| `TELEMETRY_RETENTION_DAYS` | Poda horaria con `ops.prune_events` (14 días por defecto). |

Sin Google, entra con dev login:

```bash
curl -c /tmp/admin.jar -X POST -H "Origin: $ADMIN_URL" "$ADMIN_URL/api/admin/dev-login"
curl -b /tmp/admin.jar "$ADMIN_URL/api/admin/session"
```

### Autenticación

| Endpoint | Qué hace |
| --- | --- |
| `POST /api/auth/sign-in/social` `{ "provider": "google", "callbackURL": "/" }` | Devuelve `{ url }` de Google (OAuth + PKCE). 10 intentos por minuto por IP. |
| `GET /api/auth/callback/google` | Callback de Google. Crea la sesión si el correo está en la lista. Los errores redirigen a `$ADMIN_URL/login?error=…`. |
| `POST /api/auth/sign-out` | Cierra la sesión. |
| `GET /api/admin/session` | Usuario, rol y `fresh`. 401 sin sesión, 403 si el correo salió de la lista. |
| `GET /api/admin/dev-login` · `POST /api/admin/dev-login` | Solo con `ADMIN_DEV_AUTH=1` (si no, 404). `GET` responde `{ enabled: true }` para que la SPA muestre «Entrar como dev». |

Sesiones de 8 h que se renuevan cada 15 min de uso, sin caché de cookie. Las mutaciones exigen `Origin: $ADMIN_URL` y `Content-Type: application/json`. Las rutas con `fresh` (reveal, rewake, expire, revocar agente, crear token) responden `403 not_fresh` si la sesión tiene más de `ADMIN_FRESH_SECONDS`: vuelve a entrar. Reveal admite 10 por hora por admin. Toda respuesta de `/api/admin/*` lleva `Cache-Control: no-store`.

### Producción y Compose

```bash
pnpm build --filter @team-31/admin...
pnpm with-env pnpm --filter @team-31/admin start            # ADMIN_SERVE_SPA=1: SPA + API + MCP en ADMIN_PORT
docker compose --env-file .env --env-file .env.local --profile sideband up -d admin   # solo loopback
```

### Pruebas

```bash
pnpm build --filter '@team-31/admin^...'
pnpm with-env pnpm --filter @team-31/admin test   # con TEST_DATABASE_URL corren las pruebas de Postgres
```

## MCP de administración

El servidor admin expone en `POST $ADMIN_URL/mcp` un MCP de **solo lectura** para depurar producción desde Claude Code o Codex. Usa Streamable HTTP sin estado. Cada solicitud debe incluir `Authorization: Bearer sba_…`.

- Todos los datos ya vienen redactados. Nunca hay payloads (`args`, `result` ni propósito), tokens, nonces ni texto libre de terceros.
- El MCP no ejecuta acciones. Reintentar, expirar o revocar se hace desde el panel.
- Cada `tools/call` queda en la bitácora de auditoría (`mcp:<tool>`) con el identificador del token. Para `admin_sql` se registra la llamada con el destino vacío.
- Límite: 60 solicitudes por minuto por token. Al superarlo responde `429` con `Retry-After`.

### 1. Crear un token

1. Entra al panel (`$ADMIN_URL`) con una cuenta de `ADMIN_OPERATORS`. Solo los operadores crean tokens y la sesión debe tener menos de 10 minutos. Si es más antigua, vuelve a entrar.
2. Abre **Tokens MCP → Crear token**. Ponle un nombre que identifique a quien lo usa (por ejemplo «claude-simon»), elige la duración (1 a 30 días, 7 por defecto) y los scopes:
   - `admin:read`: todas las tools de lectura.
   - `admin:sql`: además permite `admin_sql` (un `SELECT` libre sobre las vistas `ops.v_*`). Este scope incluye la lectura.
3. Copia el token `sba_…`. Se muestra **una sola vez** porque el servidor solo guarda su hash. Revócalo en la misma pantalla cuando ya no lo necesites.

Sin panel (por ejemplo en local con dev login), créalo con la API:

```bash
curl -b /tmp/admin.jar -X POST -H "Origin: $ADMIN_URL" -H "Content-Type: application/json" \
  -d '{"name":"claude-local","ttlDays":7,"scopes":["admin:read"]}' "$ADMIN_URL/api/admin/tokens"
```

Guárdalo en una variable de entorno, nunca en el repo:

```bash
export ADMIN_URL="https://admin.example.com"   # en local: http://127.0.0.1:$ADMIN_PORT
export SIDEBAND_ADMIN_TOKEN="sba_..."
```

### 2. Conectar Claude Code

```bash
claude mcp add --transport http sideband-admin "$ADMIN_URL/mcp" --header "Authorization: Bearer $SIDEBAND_ADMIN_TOKEN"
```

Verifica con `claude mcp list` o con `/mcp` dentro de una sesión. Agrega `--scope user` para usarlo en todos tus proyectos. El valor por defecto (`local`) lo deja solo en el proyecto actual.

### 3. Conectar Codex

Codex lee el token desde una variable de entorno en cada conexión. Así el token nunca queda escrito en `~/.codex/config.toml`:

```bash
codex mcp add sideband-admin --url "$ADMIN_URL/mcp" --bearer-token-env-var SIDEBAND_ADMIN_TOKEN
```

`SIDEBAND_ADMIN_TOKEN` debe estar exportada en la terminal donde abres `codex`.

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

Las peticiones de navegador a `POST /mcp` deben llevar el origen de `ADMIN_URL`; los clientes nativos pueden omitir `Origin`. Las pruebas de `server/mcp/` montan la ruta en una app Hono en memoria. Usan el cliente MCP del SDK y un `AdminQueries` falso.

```bash
pnpm test --filter @team-31/admin
```
