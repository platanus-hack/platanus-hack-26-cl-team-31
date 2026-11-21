# Broker Nexo

Desde la raíz, ejecuta `pnpm bootstrap`, configura los valores de [`.env.example`](.env.example) en `.env.local` y ejecuta `pnpm dev --filter @team-31/broker-service`. `GET /healthz` comprueba que el servicio HTTP está escuchando en `BROKER_URL`.

- `BROKER_SIGNING_KEY` es una JWK privada Ed25519. `SERVICE_JWT_PUBLIC_KEYS` es un objeto JSON con las JWK públicas `mcp`, `web` y, opcionalmente, `admin` (rutas `/v1/admin/*`), correspondientes a las claves privadas de cada servicio. Escribe los valores JSON entre comillas simples en `.env.local`.
- `NONCE_KEY` y `WAKE_SECRETS_KEY` son claves distintas de 32 bytes en base64. Puedes generar cada una con `openssl rand -base64 32`. Conserva los valores al reiniciar para preservar los nonces pendientes y descifrar las configuraciones de aviso guardadas.
- `REQUEST_TTL_SECONDS` vale 900 por defecto. El primer aviso está disponible de inmediato. `WAKE_RETRY_DELAYS_MS` indica el tiempo antes del segundo y tercer intento, respectivamente, con `10000,30000` por defecto. El worker revisa la cola una vez por segundo.
- `WAKE_ALLOW_INSECURE=1` permite HTTP local en desarrollo. El broker rechaza esta configuración en producción.

En el worktree, `pnpm bootstrap` aplica las migraciones del esquema `nexo` con el rol dueño y genera `BROKER_DATABASE_PASSWORD` en `.env.local`. El broker usa el rol `nexo_broker` para consultar Postgres y añadir eventos a la bitácora. Para preparar nuevamente un volumen local, ejecuta `pnpm nexo:broker:migrate`. Si configuras otra base, [aplica las migraciones con el rol dueño del esquema](../../packages/broker/drizzle/README.md) y suministra al broker la URL de un rol limitado. Para una sesión en memoria, define `DATABASE_URL=''` en `.env.local`.

Para usar Docker, ejecuta `pnpm build --filter @team-31/broker-service` y después `docker compose --env-file .env --env-file .env.local --profile nexo up -d broker` desde la raíz. El puerto del broker queda publicado en el loopback del host.

`GET /v1/owner/stream` requiere un JWT de web. Envía eventos SSE `activity` con un `ActivityItem` del dueño autenticado. Al abrir o reconectar, envía hasta 30 solicitudes recientes de la más antigua a la más nueva. Luego envía las solicitudes nuevas o modificadas de esa ventana. El ID de evento identifica una versión del `ActivityItem`. Los clientes pueden actualizar cada solicitud por `requestId` y deduplicar por ID de evento. El cliente debe obtener un token válido para cada conexión.
