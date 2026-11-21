# Stack local de Nexo

Usa Node 24, pnpm 10 y Docker. Cada worktree tiene Postgres, puertos y llaves locales. `pnpm env:init` genera `.env` con las URLs según el slot. `pnpm bootstrap` genera las llaves faltantes en `.env.local`, levanta Postgres y aplica el esquema de autenticación. Conserva `.env.local` junto al volumen del worktree para que el broker pueda seguir descifrando las configuraciones de aviso guardadas.

## Arranque

```sh
pnpm bootstrap
pnpm dev
```

`pnpm bootstrap` prepara el esquema `nexo` y el rol `nexo_broker`, que usa una contraseña local generada. El broker escucha en loopback. Postgres, web y MCP usan sus puertos asignados al worktree. Los servicios de coordinación siguen disponibles mediante `pnpm agents:up`.

Para iniciar sesión con Google, configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.local`. En la consola de tu cliente OAuth agrega como retorno el valor de `BETTER_AUTH_URL` seguido de `/api/auth/callback/google`. Con las credenciales de Google omitidas, puedes iniciar el stack, consultar metadata y usar clientes de prueba locales.

```sh
pnpm --silent with-env sh -c 'printf "Web: %s\nMCP: %s\nBroker: %s\n" "$BETTER_AUTH_URL" "$MCP_RESOURCE_URL" "$BROKER_URL"'
```

## Verificación local

```sh
pnpm with-env sh -c 'curl --fail --silent --show-error "$BROKER_URL/healthz"'
pnpm with-env sh -c 'curl --fail --silent --show-error "${MCP_RESOURCE_URL%/mcp}/healthz"'
pnpm with-env sh -c 'curl --silent --include -X POST "$MCP_RESOURCE_URL"'
pnpm with-env sh -c 'curl --fail --silent --show-error "$BETTER_AUTH_URL/.well-known/oauth-authorization-server"'
```

El POST a MCP sin credenciales devuelve `401` con `WWW-Authenticate` y `resource_metadata`. Las otras consultas deben devolver `200`.

Con el stack detenido, activa las credenciales de prueba y los avisos de loopback para ensayar el flujo aislado. Estos ajustes se aplican solo a ese proceso y se rechazan en modo producción.

```sh
pnpm with-env env MCP_DEV_AUTH=1 WAKE_ALLOW_INSECURE=1 REQUEST_TTL_SECONDS=20 WAKE_RETRY_DELAYS_MS=0,0 pnpm exec turbo run dev --filter @team-31/broker-service --filter @team-31/mcp --filter @team-31/web
```

Desde otra terminal ejecuta el harness local. El [README de la suite](../e2e/README.md) documenta también el modo OAuth con usuarios de prueba.

```sh
pnpm with-env sh -c 'E2E_MCP_URL="$MCP_RESOURCE_URL" E2E_AUTH_MODE=dev pnpm --filter @team-31/e2e test'
```

Los valores de los tres servicios se describen en [broker](../apps/broker/.env.example), [MCP](../apps/mcp/.env.example) y [web](../apps/web/.env.example). Para restaurar la configuración normal, detén los procesos de prueba e inicia `pnpm dev`.

Corre `pnpm lint`, `pnpm typecheck` y `pnpm test` desde la raíz. Los tests de Postgres usan la base de pruebas del worktree. `pnpm teardown` elimina los contenedores y datos del worktree cuando terminas.
