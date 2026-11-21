# Pruebas de punta a punta de Sideband

La suite llama al MCP remoto por Streamable HTTP con el SDK oficial. Prepara direcciones, reglas y conexiones por el puerto de dueño del broker. Comprueba el ciclo de las solicitudes, el aislamiento entre usuarios, los bloqueos, el cierre por el worker y los avisos de OpenClaw, Grok Bot, MCP Events y Standard Webhooks. Los receptores locales validan las firmas y rechazan cualquier contenido ajeno al aviso.

## Preparar el stack local

La regresión de revocación en `src/trace.test.ts` levanta MCP y broker en puertos efímeros y crea una base aislada desde `TEST_DATABASE_URL`. No necesita `E2E_MCP_URL` ni un modelo. Es obligatoria en CI: verifica que una respuesta pendiente y otra ya guardada no se entreguen tras la revocación.

1. Ejecuta `pnpm bootstrap` desde un worktree de prueba con Node 24 y pnpm 10. Prepara Postgres, las llaves en `.env.local` y el esquema de auth. La suite usa `BROKER_URL` y `WEB_SERVICE_PRIVATE_KEY` para preparar sus datos.
2. Inicia el stack como indica la [guía local](../docs/local-stack.md), con `WAKE_ALLOW_INSECURE=1`, `REQUEST_TTL_SECONDS=20` y `WAKE_RETRY_DELAYS_MS=0,0`. El broker corre en el host y los receptores falsos usan un puerto efímero de loopback. Para OAuth se usa la app web local.
3. Usa el worktree de prueba para guardar las direcciones y solicitudes creadas por la suite. Las URL de MCP y del broker deben apuntar al loopback.

## Modo de desarrollo

Pon `MCP_DEV_AUTH=1` en el proceso MCP antes de iniciarlo. La suite genera usuarios nuevos y usa tokens `dev:<userId>:<agentId>`. Desde la raíz, ejecuta lo siguiente con el stack levantado.

```sh
pnpm with-env sh -c 'E2E_MCP_URL="$MCP_RESOURCE_URL" E2E_AUTH_MODE=dev pnpm --filter @team-31/e2e test'
```

`pnpm test` omite estas pruebas si `E2E_MCP_URL` está ausente. Para ejecutar una sola prueba, añade el nombre del archivo, por ejemplo `pnpm --filter @team-31/e2e test src/isolation.test.ts`, después de cargar el entorno y exportar `E2E_MCP_URL`. Configura `E2E_ISOLATION_COUNT` para cambiar la cantidad de solicitudes en paralelo (80 por defecto).

## Modo OAuth

Inicia MCP con `MCP_DEV_AUTH=0`. Obtén access tokens Bearer de cuentas de prueba mediante el proveedor OAuth local. Cada token necesita la audiencia de `MCP_RESOURCE_URL`, los permisos `sideband:ask`, `sideband:inbox`, `sideband:reply` y `sideband:status` y un usuario distinto. Usa cuentas con una dirección reservada para pruebas que empiece con `e2e-` o cuentas sin dirección. La suite puede asignarles una dirección y actualizar sus reglas de prueba.

Guarda los tokens como JSON, entre comillas simples, en `.env.local`. Reemplaza cada marcador del ejemplo por un token real de prueba.

```sh
E2E_OAUTH_TOKENS='{"contract":["<token>","<token>","<token>"],"blocks":["<token>","<token>"],"closure":["<token>","<token>"],"isolation":["<token>","<token>","<token>"]}'
```

Para aislamiento, se usan al menos tres cuentas y como máximo 28 solicitudes por remitente. Si subes `E2E_ISOLATION_COUNT` por encima de 84, añade una cuenta por cada 28 solicitudes adicionales o fracción. Si repites el modo OAuth con los mismos usuarios, deja pasar un minuto entre corridas para que se restablezca la cuota de solicitudes.

```sh
pnpm with-env sh -c 'E2E_MCP_URL="$MCP_RESOURCE_URL" E2E_AUTH_MODE=oauth pnpm --filter @team-31/e2e test'
```
