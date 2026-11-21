# AGENTS.md

Monorepo pnpm + Turborepo (Node 24, pnpm 10). Apps en `apps/*`, paquetes compartidos en `packages/*`. Infra local con Docker Compose.

## Setup (por worktree)

Varios devs/agentes trabajan en paralelo, cada uno en su propio worktree. Cada worktree recibe un **SLOT** único que define sus puertos y su stack Docker aislado (contenedores y datos propios).

```bash
git worktree add ../team-31-<nombre> -b <rama>   # fuera del repo, no anidado
cd ../team-31-<nombre>
pnpm bootstrap      # install + genera .env (slot/puertos) + levanta Postgres
pnpm dev            # todas las apps; una sola: pnpm dev --filter @team-31/web
```

Al terminar con un worktree: `pnpm teardown` (borra sus contenedores/datos y libera el slot) y luego `git worktree remove <path>`.

## Puertos y variables

`.env` lo genera `scripts/env-init.sh` — **no editarlo a mano**. Revisa tu slot y puertos con `cat .env`.

| Servicio | Variable        | Puerto          |
| -------- | --------------- | --------------- |
| web      | `WEB_PORT`      | `3000 + SLOT`   |
| agentes (HTTP local) | `COORDINATION_PORT` | `4310 + SLOT` |
| postgres | `POSTGRES_PORT` | `54320 + SLOT`  |

- Secretos/API keys: `.env.local` (gitignored). Declara cada variable nueva en `.env.local.example`.
- `pnpm dev|build|test` cargan `.env` + `.env.local` automáticamente. Para cualquier otro comando: `pnpm with-env <cmd>` (ej. `pnpm with-env pnpm --filter @team-31/web <script>`).
- Nunca hardcodear puertos ni URLs: leer siempre de env.

## Base de datos

Postgres 17 (`docker-compose.yml`). User/pass `postgres`/`postgres`.

- Dev: `DATABASE_URL` (db `app`). Tests: `TEST_DATABASE_URL` (db `app_test`, separada).
- `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:reset` (borra datos y re-crea).
- Scripts SQL de init en `infra/postgres/init/` (solo corren al crear el volumen).

## Identidad Nexo

- OAuth en web usa `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `MCP_RESOURCE_URL`. El origen local `BETTER_AUTH_URL` se genera a partir de `WEB_PORT`. Prepara el esquema OAuth con `pnpm with-env pnpm --filter @team-31/web auth:migrate` después de compilar los paquetes compartidos. Sus pruebas usan `TEST_DATABASE_URL` y credenciales ficticias de Google.
- El MCP remoto verifica los access tokens con `AUTH_ISSUER`, `AUTH_JWKS_URL` y `MCP_RESOURCE_URL`. `MCP_DEV_AUTH=1` habilita tokens de desarrollo fuera de producción.
- MCP y web firman JWT para el broker con `MCP_SERVICE_PRIVATE_KEY` y `WEB_SERVICE_PRIVATE_KEY` respectivamente. Web usa `BROKER_URL` para consultar la dirección Nexo. El broker verifica con `SERVICE_JWT_PUBLIC_KEYS` (JSON con las claves JWK públicas `mcp` y `web`).

## Coordinación local entre N asistentes

1. Desde la raíz con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3`. Déjalo abierto. Prepara el esquema, crea las identidades faltantes e inicia la API del worktree. Usa 2 para Ana y Bob o aumenta N para sumar participantes.
2. En otra terminal ejecuta `pnpm agents:demo 3`. Usa el mismo N o uno menor. Cada participante abre un proceso MCP y Eva, una identidad externa al grupo, comprueba la denegación.
3. Para ampliar un servicio que ya está corriendo, ejecuta `pnpm agents:seed 5`. Para usar clientes interactivos, sigue [las instrucciones de MCP](apps/mcp/README.md).

El servidor usa `DATABASE_URL`. Cada adaptador MCP recibe `COORDINATION_API_URL` y su propio `AGENT_TOKEN` de un archivo privado en `.agents-local/`. Conserva esa carpeta junto a la base para volver a abrir las sesiones. PostgreSQL guarda permisos, disponibilidad, publicaciones y encuentros. La política bilateral de `apps/broker` se ejecuta en el servidor. `pnpm test` usa la base separada `app_test`.

Ctrl+C detiene la API del host y `pnpm infra:down` detiene PostgreSQL conservando el volumen. Después de preparar el esquema, las cuentas y el build, también puedes iniciar la API en segundo plano con `docker compose --profile agents up -d coordination` con el puerto del host libre. Para detener ese stack usa `docker compose --profile agents down`.

## Consultas resueltas por el runtime del titular

Ejecuta `corepack pnpm agents:runtime-demo` para probar los dos modos del broker Nexo. Ana descubre el contrato de Bob, lee su perfil publicado y pregunta por un interés. La segunda consulta queda pendiente hasta que el proceso de Bob recibe un aviso y ejecuta su conector local. La demo usa IPC y un almacén efímero. El recorrido MCP con PostgreSQL se prueba por separado con `pnpm agents:demo`.

## Comandos

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`. Antes de dar algo por listo: `pnpm lint && pnpm typecheck` (y `pnpm test` si aplica).

## ⚠️ Al agregar infra o configuración nueva

Si agregas un servicio (Redis, cola, etc.), una app que expone un puerto, o una variable de entorno, **en el mismo PR**:

1. Servicio en `docker-compose.yml` con puerto `${<SERVICIO>_PORT}` (nunca fijo).
2. Puerto `BASE + SLOT` en `scripts/env-init.sh` (bloque de puertos y `.env` generado). Elige una base que no choque.
3. Variables secretas en `.env.local.example`.
4. **Actualiza este AGENTS.md** (tabla de puertos, sección del servicio, comandos). Si no está aquí, el próximo agente no sabrá levantarlo.

Instrucciones específicas de cada app viven en `apps/<app>/AGENTS.md` o `README.md`.
