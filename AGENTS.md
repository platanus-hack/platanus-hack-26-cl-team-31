# AGENTS.md

Monorepo pnpm + Turborepo (Node 24, pnpm 10). Apps en `apps/*`, paquetes compartidos en `packages/*`. Infra local con Docker Compose.

## Mapa del repositorio

El MVP conserva MCP, server y broker como servicios separados, con bóvedas alojadas en Nexo. La columna de destino describe la **propuesta de unificación** que mantiene el ciclo de las solicitudes en el broker. Esa asignación sigue pendiente de decisión del equipo.

| Módulo | Qué hace hoy | Destino propuesto |
| --- | --- | --- |
| `apps/web` | Login OAuth, interfaz del titular y dashboard local `/demo`. | Conservar como interfaz. El dashboard y la CLI deben consumir las mismas operaciones. |
| `apps/mcp` | Expone las tools de Nexo a los asistentes y llama al broker con la identidad delegada. | Conservar como adaptador MCP común, incluidas las consultas a contactos. |
| `apps/broker`, `packages/broker` | La app expone HTTP y arranca el worker. El paquete implementa reglas de acceso, solicitudes, aprobación del titular, almacenamiento y clientes. | Conservar como autoridad sobre permisos, solicitudes y entrega de resultados. |
| `apps/server` | API de coordinación con contactos, membresías, calendario, publicaciones y reuniones en PostgreSQL. Hoy también autentica tokens de la seed y expone su propio adaptador MCP. | Conservar bóvedas, grupos y reuniones. Retirar el directorio y las publicaciones. Migrar los consumidores y el historial antes de retirar `people.token_hash`, `availability_requests` y `apps/server/src/mcp.ts`. |
| `packages/protocol`, `packages/auth`, `packages/wake` | `protocol` define herramientas, reglas y mensajes. `auth` implementa OAuth y JWT de servicio. `wake` envía avisos a agentes. | Conservar y reutilizar desde los servicios y sus clientes. |
| `apps/admin`, `packages/telemetry`, `packages/ops` | Panel y MCP de administración, instrumentación y esquema operativo de PostgreSQL. | Conservar para seguir las solicitudes por `requestId`. |
| `apps/demo` | Ejecuta el escenario local de Contactos de Ana desde la CLI y el dashboard. | Conservar el escenario y los datos de prueba. Al conectarlo al stack persistente, retirar el arranque del broker por sesión y la traducción de `demo_profiles.interest_readers` a reglas. |
| `infra/`, `scripts/`, `packages/typescript-config`, `e2e/` | Preparación del entorno, comandos de desarrollo y ensayos, configuración TypeScript y pruebas del stack. | Conservar como soporte. Para probar OAuth, web, MCP y broker juntos, usar el [guion de scripts/demo](docs/demo.md). |

Las guías viven en `docs/`. [docs/poc](docs/poc/README.md) conserva el prototipo anterior al monorepo como referencia histórica.

## Modelo de producto

Un titular pregunta al agente de otro titular. El broker decide si la pregunta llega y qué campos de la respuesta vuelven.

### Permisos

`SharingRules` (`packages/protocol/src/rules.ts`) es el único modelo de permisos. Cada titular guarda las suyas en el broker y `evaluate` (`packages/broker/src/policy/evaluate.ts`) decide por remitente, tool y campos. Un permiso nuevo es una tool o un campo en `packages/protocol/src/tools.ts` más una regla en `SharingRules`.

Decisión del 2026-11-21: Nexo deja de publicar información. Estas piezas se retiran y solo reciben cambios que las migren:

- `publicProfile` y la tool `profile`, que el broker responde sin consultar al agente del titular.
- El directorio y `interests.audience` en `apps/server`.
- `memberships.can_ask` y `can_share` en `apps/server`, que pasan a `circles` y `grants`.
- `demo_profiles.interest_readers` en `apps/demo`, que pasa a `people`.

### Vocabulario

Usa un término por concepto, en el código y en los textos.

| Término | En el código | Qué es |
| --- | --- | --- |
| Titular | `Owner`, `userId` | Persona que define sus reglas y responde por sus datos. «Dueño» en textos anteriores. |
| Agente | `Principal`, `agentId` | Asistente conectado que actúa por un titular con sus `scopes`. |
| Dirección Nexo | `Address` | Identificador `nombre@dominio` con el que otros titulares le escriben. |
| Solicitud | `AskInput`, `requestId` | Pregunta de un titular a otro con una tool. Termina en un `FinalOutcome`. |
| Tool | `ToolName` | Operación que se puede pedir: `availability`, `question`, `interest_check`. `profile` está en retiro. |
| Regla | `SharingRules` | Lo que un titular permite: `circles`, `grants`, `people`, `blocked` y `defaultForUnknown`. |
| Círculo | `circles` | Lista de direcciones con nombre que arma el titular. |
| Permiso | entrada de `grants` o `people` | Una tool, los campos de respuesta permitidos y una guía para el agente. |
| Aviso | `WakeTarget`, `WakeNotice` | Notificación al agente del destinatario de que tiene una solicitud. |
| Bandeja | `InboxItem` | Solicitudes pendientes que lee el agente del destinatario. |

### Invariantes

Todo cambio en `packages/broker`, `packages/protocol` o `apps/mcp` conserva estas seis. Sus pruebas viven en `packages/broker/src/core/broker.test.ts`; si cambias una, cambia su prueba en el mismo PR.

1. La identidad del remitente sale del token. `AskInput` carece de campo de remitente.
2. Una denegación llega firmada y sin motivo, y la solicitud nunca despierta al destinatario.
3. La respuesta pasa por `filterResult` y sale solo con los campos permitidos.
4. Antes de entregar, `stillAuthorized` evalúa de nuevo las reglas. Revocar a mitad de camino impide la entrega.
5. Cada solicitud termina en un solo estado final. Una segunda respuesta recibe `conflict`.
6. El aviso lleva solo `requestId` y `event`. El contenido se lee de la bandeja con la identidad del destinatario.

La revisión completa está en [docs/security.md](docs/security.md).

## Antes de escribir código

Cada capacidad tiene un dueño. Búscalo con `git grep` antes de crear un archivo, extiéndelo y nombra en el PR lo que reutilizaste.

| Necesitas | Ya existe en |
| --- | --- |
| Rutas HTTP del broker con sus esquemas y emisor | `routes` de `@team-31/protocol/http` |
| Llamar al broker | `createAgentClient` y `createOwnerClient` de `@team-31/broker/client` |
| Firmar o verificar un JWT de servicio | `mintServiceToken` y `verifyServiceToken` de `@team-31/auth/service` |
| Verificar un access token OAuth | `createMcpGuard` de `@team-31/auth/resource` |
| Enviar un aviso o verificar su firma | `createWaker` y `verifyWebhookSignature` de `@team-31/wake` |
| Eventos, errores y `fetch` con traza | `@team-31/telemetry` |
| Generar llaves | `infra/gen-keys.ts` |
| Usuarios y reglas de prueba | `fixtureUsers` y `fixtureSharingRules` de `@team-31/protocol` |
| Receptor falso de avisos | `startFakeReceivers` de `e2e/src/fake-receivers.ts` |

- **La segunda copia se mueve.** Cuando dos módulos necesitan lo mismo, mueve el original a `packages/*` en ese PR e importa desde ambos. Deuda actual: tres limitadores de ventana fija (`apps/broker/src/http/rate-limit.ts`, `apps/admin/server/rate-limit.ts`, `apps/admin/server/mcp/rate-limit.ts`) y el esquema zod de la JWK Ed25519 repetido en `apps/broker/src/env.ts` y `apps/admin/server/env.ts`. Unifícalos antes de sumar otro uso.
- **El reparto de archivos de un issue define quién edita. Importar siempre está permitido.** Si lo que necesitas vive en la carpeta de otro issue, impórtalo. Si falta, pídelo en el PR.
- **Programa contra código que existe en `main`.** Si tu issue depende de un módulo pendiente, entrega ambos juntos o deja el PR en draft hasta que llegue. Un stub que lanza, un `Proxy` que simula la interfaz o un `import()` con ruta variable pasan el build y dejan el servicio respondiendo 502.
- **Un camino por capacidad.** Hay cinco servidores MCP, tres receptores de avisos de prueba y tres demos. Uno nuevo, o un cliente HTTP nuevo, lleva en el PR una línea que explica por qué el existente no sirve.
- **Un PR, un issue.** Apunta a menos de 500 líneas propias. El lockfile, el código generado y las skills copiadas van en un commit separado.

## Setup (por worktree)

Varios devs/agentes trabajan en paralelo, cada uno en su propio worktree. Cada worktree recibe un **SLOT** único que define sus puertos y su stack Docker aislado (contenedores y datos propios).

```bash
git worktree add ../team-31-<nombre> -b <rama>   # fuera del repo, no anidado
cd ../team-31-<nombre>
pnpm bootstrap      # instala, asigna un slot, levanta Postgres y prepara llaves y esquemas
pnpm dev            # todas las apps; una sola: pnpm dev --filter @team-31/web
```

Al terminar con un worktree: `pnpm teardown` (borra sus contenedores/datos y libera el slot) y luego `git worktree remove <path>`.

## Puertos y variables

`.env` lo genera `scripts/env-init.sh` — **no editarlo a mano**. Revisa tu slot y puertos con `cat .env`.

| Servicio | Variable        | Puerto          |
| -------- | --------------- | --------------- |
| web      | `WEB_PORT`      | `3000 + SLOT`   |
| MCP Nexo | `MCP_PORT` | `4100 + SLOT` |
| broker Nexo | `BROKER_PORT` | `4200 + SLOT` |
| agentes (HTTP local) | `COORDINATION_PORT` | `4310 + SLOT` |
| admin (SPA, y todo en producción) | `ADMIN_PORT` | `4400 + SLOT` |
| admin (API + MCP en dev) | `ADMIN_API_PORT` | `4450 + SLOT` |
| postgres | `POSTGRES_PORT` | `54320 + SLOT`  |
| Ollama (dashboard opcional) | `DEMO_MODEL_PORT` | `11440 + SLOT` |

- Secretos/API keys: `.env.local` (gitignored). Declara cada variable nueva en `.env.local.example`.
- `pnpm dev|build|test` cargan `.env` + `.env.local` automáticamente. Para cualquier otro comando: `pnpm with-env <cmd>` (ej. `pnpm with-env pnpm --filter @team-31/web <script>`).
- Nunca hardcodear puertos ni URLs: leer siempre de env.

## Base de datos

Postgres 17 (`docker-compose.yml`). User/pass `postgres`/`postgres`.

- Dev: `DATABASE_URL` (db `app`). Tests: `TEST_DATABASE_URL` (db `app_test`, separada).
- `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:reset` (borra datos y re-crea).
- Scripts SQL de init en `infra/postgres/init/` (solo corren al crear el volumen).

## Identidad Nexo

- OAuth en web usa `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` y `MCP_RESOURCE_URL`. El origen local `BETTER_AUTH_URL` se genera a partir de `WEB_PORT`. `pnpm bootstrap` prepara el esquema OAuth y genera las llaves faltantes en `.env.local`. Google se habilita al configurar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Sus pruebas usan `TEST_DATABASE_URL`. Consulta [Stack local de Nexo](docs/local-stack.md).
- El MCP remoto verifica los access tokens con `AUTH_ISSUER`, `AUTH_JWKS_URL` y `MCP_RESOURCE_URL`. `MCP_DEV_AUTH=1` habilita tokens de desarrollo fuera de producción.
- MCP, web y el servidor admin firman JWT para el broker con `MCP_SERVICE_PRIVATE_KEY`, `WEB_SERVICE_PRIVATE_KEY` y `ADMIN_SERVICE_PRIVATE_KEY` respectivamente. Web usa `BROKER_URL` para consultar la dirección Nexo. El broker verifica con `SERVICE_JWT_PUBLIC_KEYS` (JSON con las claves JWK públicas `mcp`, `web` y `admin`). `pnpm bootstrap` (`node infra/gen-keys.ts`) genera las que falten y agrega `admin` a un `SERVICE_JWT_PUBLIC_KEYS` existente.
- El JWT `iss=admin` (`mintServiceToken({ iss: "admin", sub: adminId, email, privateKey })`) solo vale en `/v1/admin/*` (`rewake`, `expire`, `revokeAgent` del `AdminPort`); el broker lo rechaza en `/v1/agent/*` y `/v1/owner/*`, y los JWT `mcp` y `web` no valen en `/v1/admin/*`. Sin `SERVICE_JWT_PUBLIC_KEYS.admin`, esas rutas responden 401.

## MCP Nexo

- `pnpm env:init` genera `MCP_RESOURCE_URL` con el puerto del worktree, y `AUTH_ISSUER` y `AUTH_JWKS_URL` con el puerto web. Ajusta los valores en `.env.local` si cambias el origen público.
- Usa `pnpm dev --filter @team-31/mcp` para iniciar solo MCP. Escucha en loopback por defecto y expone `GET /healthz`.
- La [guía del MCP](apps/mcp/README.md) cubre stdio de desarrollo y el perfil Compose `nexo`.

## Broker Nexo

- Después de `pnpm bootstrap`, inicia solo el broker con `pnpm dev --filter @team-31/broker-service`. `pnpm env:init` actualiza worktrees existentes y genera `BROKER_PORT` y `BROKER_URL`.
- Conserva en `.env.local` las llaves que generó `pnpm bootstrap`. Configura `REQUEST_TTL_SECONDS` o `WAKE_RETRY_DELAYS_MS` para probar plazos y reintentos más cortos.
- `pnpm bootstrap` genera `BROKER_DATABASE_PASSWORD`, aplica las migraciones del broker y prepara el rol `nexo_broker`. El broker local se conecta con ese rol. `DATABASE_URL` del worktree se usa para migrar y para los demás servicios que ya la consumen. Para repetir la preparación de la base del broker, ejecuta `pnpm nexo:broker:migrate`.
- `BROKER_HOST` usa `127.0.0.1` por defecto. Para correrlo en Docker, compila con `pnpm build --filter @team-31/broker-service` y ejecuta `docker compose --env-file .env --env-file .env.local --profile nexo up -d broker`. Compose solo publica el puerto en loopback.
- `WAKE_ALLOW_INSECURE=1` permite avisos HTTP locales durante el desarrollo. Consulta [la guía del broker](apps/broker/README.md) para los detalles de Postgres, los avisos y el stream de actividad.

## Coordinación local entre N asistentes

1. Desde la raíz con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3`. Déjalo abierto. Prepara el esquema, crea las identidades faltantes e inicia la API del worktree. Usa 2 para Ana y Bob o aumenta N para sumar participantes.
2. En otra terminal ejecuta `pnpm agents:demo 3`. Usa el mismo N o uno menor. Cada participante abre un proceso MCP y Eva, una identidad externa al grupo, comprueba la denegación.
3. Para ampliar un servicio que ya está corriendo, ejecuta `pnpm agents:seed 5`. Para usar clientes interactivos, sigue [las instrucciones de MCP](apps/mcp/README.md).

El servidor usa `DATABASE_URL`. Cada adaptador MCP (`apps/server/dist/mcp.js`) recibe `COORDINATION_API_URL` y su propio `AGENT_TOKEN` de un archivo privado en `.agents-local/`. Conserva esa carpeta junto a la base para volver a abrir las sesiones. PostgreSQL guarda permisos, disponibilidad, publicaciones y encuentros. El permiso de grupo se evalúa en SQL dentro de `apps/server/src/availability.ts`. `pnpm test` usa la base separada `app_test`.

Ctrl+C detiene la API del host y `pnpm infra:down` detiene PostgreSQL conservando el volumen. Después de preparar el esquema, las cuentas y el build, también puedes iniciar la API en segundo plano con `docker compose --profile agents up -d coordination` con el puerto del host libre. Para detener ese stack usa `docker compose --profile agents down`.

En el dashboard de desarrollo `/demo`, **Fútbol del sábado** llama por HTTP a `apps/server` con la identidad de la seed y a Ollama por loopback (`DEMO_MODEL_URL`, modelo `qwen3:4b-instruct` por defecto). Para arrancar Ollama, elige el perfil Compose `demo-model` o un proceso nativo. Los comandos están en el [README](README.md).

## Qué ejecuta apps/demo · Contactos de Ana

Con PostgreSQL del worktree activo, `corepack pnpm agents:seed` prepara 15 perfiles de prueba. Con Claude Code autenticado, ejecuta `corepack pnpm with-env corepack pnpm agents:runtime-demo "¿A alguien le interesa la cerámica?"`. La CLI y el modo **Contactos de Ana** de `/demo` llaman a [runContactSession](apps/demo/src/contact-session.mjs).

1. La sesión lee `contacts` y `demo_profiles.interest_readers` directamente de PostgreSQL. Claude Code usa un MCP stdio propio de la demo con `list_contacts`, `ask_contact` y `await_contact`.
2. Ese MCP arranca el ejecutable real de `apps/broker` en loopback y lo llama por HTTP con JWT de servicio. Genera llaves, registra identidades ficticias y carga sus reglas por sesión. Las solicitudes y la cola viven en memoria. Este recorrido funciona sin el broker persistente del worktree, el login OAuth, `apps/mcp` ni la API de `apps/server`. [Arranque del broker y receptor de avisos](apps/demo/src/demo-broker.mjs)
3. Si el broker deniega, la solicitud se cierra antes del webhook. Si autoriza `interest_check`, envía un webhook firmado al receptor local. El agente del contacto ejecuta Claude Code con la tool `check_interest`, que lee su JSON privado en `.agents-local/`. El broker devuelve la respuesta filtrada a Ana. [Runtime del contacto](apps/demo/src/contact-runtime.mjs) · [Relaciones y datos de prueba](apps/mcp/README.md#buscar-entre-los-agentes-de-la-agenda)

## Pruebas de punta a punta de Nexo

- [`e2e/`](e2e/README.md) prueba el stack local con clientes MCP del SDK. La suite se ejecuta cuando se define `E2E_MCP_URL` y usa `BROKER_URL` y `WEB_SERVICE_PRIVATE_KEY` de un worktree de prueba.
- `E2E_AUTH_MODE` vale `dev` por defecto. Para `oauth`, pasa los access tokens de cuentas de prueba en `E2E_OAUTH_TOKENS`. `E2E_ISOLATION_COUNT` controla cuántas solicitudes simultáneas se envían (80 por defecto).
- El broker debe ejecutarse en el host para llamar a los receptores falsos, que usan un puerto efímero en loopback. Configura `WAKE_ALLOW_INSECURE=1`, `REQUEST_TTL_SECONDS=20` y `WAKE_RETRY_DELAYS_MS=0,0`.

## 🔭 Todo debe ser monitoreable por el admin (obligatorio)

Nexo se depura en producción con `apps/admin` (panel + MCP de administración). Diseño: [docs/admin.md](docs/admin.md). Cualquier funcionalidad nueva o modificada **en el mismo PR** debe:

1. **Emitir telemetría** con `@team-31/telemetry` (`emit`, `span`, `error`). Cada transición de estado, llamada externa, decisión de permisos o de autenticación y cada error genera un evento. Si el evento no existe, decláralo en `packages/telemetry/src/catalog.ts` con su esquema. Incluye `requestId`, `userId` y `agentId` cuando existan.
2. **Nunca tragarse un error**: `catch` → `telemetry.error(operación, error)` y devolver el `errorId` (encabezado `X-Error-Id`). Nada de `console.error` suelto.
3. **Propagar la traza**: toda llamada HTTP interna usa `tracedFetch` (encabezado `traceparent`) y todo servidor Hono usa `honoTelemetry`.
4. **Exponer su estado al admin**: si agregas o cambias una tabla o una columna, crea o actualiza su vista redactada `ops.v_*` en `packages/ops/sql/` (nueva migración numerada). Si es una entidad nueva, agrega su lectura a `AdminQueries` (`apps/admin/shared/queries.ts`) y, si aplica, su página en el panel y su tool en el MCP admin.
5. **No filtrar datos**: nunca pongas en eventos, logs ni vistas tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result` ni texto libre de terceros. El payload real solo se ve en `ops.v_request_payloads`, con un motivo y auditoría.
6. **Servicio nuevo**: emite `service.started` y `service.heartbeat` y expone `GET /healthz`.
7. **Mutaciones operativas** (reintentar, expirar, revocar…) se exponen en el `AdminPort` del broker, nunca como `UPDATE` directo desde el admin.

En la descripción del PR agrega una línea **«Cómo se ve en el admin:»** con el evento, la vista o la pantalla donde se observa el cambio.

Hoy solo `apps/admin` importa `@team-31/telemetry`. Broker, MCP, web y `apps/server` registran con `console` hasta ADM-07, y `packages/ops/sql/` solo contiene `0001_events.sql`. Al tocar uno de esos servicios, instrumenta lo que cambias con `createTelemetry` y reemplaza los `// TODO(admin): <evento>` del archivo por la llamada real.

## Admin y observabilidad

- App en `apps/admin`: SPA React + Vite + shadcn (preset Nova, Radix) en `src/`, servidor Hono (API, auth y MCP admin) en `server/` y contrato compartido en `shared/`. Instrucciones en [apps/admin/AGENTS.md](apps/admin/AGENTS.md).
- `pnpm dev --filter @team-31/admin` levanta la SPA en `ADMIN_PORT` (Vite, con proxy de `/api` y `/mcp`) y el servidor admin en `ADMIN_API_PORT` (`tsx watch`). Acceso por `ADMIN_OPERATORS`/`ADMIN_VIEWERS` (Google con `ADMIN_GOOGLE_CLIENT_ID/SECRET`) o, fuera de producción, `ADMIN_DEV_AUTH=1` y `POST /api/admin/dev-login`. Esquema `admin` en producción: `pnpm with-env pnpm --filter @team-31/admin admin:auth:migrate`. Compose: servicio `admin` del perfil `nexo` (todo en `ADMIN_PORT`, solo loopback). Detalles en [apps/admin/README.md](apps/admin/README.md).
- Esquema `ops` en Postgres (`packages/ops`): `ops.events` (telemetría) y vistas redactadas `ops.v_*`. Migrar: `pnpm --filter @team-31/ops build && pnpm with-env pnpm --filter @team-31/ops migrate`.
- Telemetría: `@team-31/telemetry` (`createTelemetry`, `tracedFetch`) y `@team-31/telemetry/hono` (`honoTelemetry`). Instrumentación en 5 líneas y catálogo en [packages/telemetry/README.md](packages/telemetry/README.md). `TELEMETRY_SINK=postgres|console|off`.
- Variables `ADMIN_*` y `TELEMETRY_*` en `.env.local.example`.
- UI: usa la skill `shadcn` (`.agents/skills/shadcn`, enlazada en `.claude/skills`) y el MCP `shadcn` de `.mcp.json`. Componentes con `pnpm dlx shadcn@latest add <componente>` desde `apps/admin`.

## Comandos

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`. Antes de dar algo por listo: `pnpm lint && pnpm typecheck` (y `pnpm test` si aplica).

`pnpm lint` solo cubre `apps/admin` y `apps/web`. El resto depende de `pnpm typecheck` y `pnpm test`, y `apps/demo` queda fuera de `typecheck`.

Las validaciones se ejecutan en el worktree local. `.github/workflows/cd.yml` corre build y typecheck en cada push a `main` y dispara los deploy hooks de Render para los servicios de `render.yaml` (web, broker, MCP y coordinación).

## ⚠️ Al agregar infra o configuración nueva

Si agregas un servicio (Redis, cola, etc.), una app que expone un puerto, o una variable de entorno, **en el mismo PR**:

1. Servicio en `docker-compose.yml` con puerto `${<SERVICIO>_PORT}` (nunca fijo).
2. Puerto `BASE + SLOT` en `scripts/env-init.sh` (bloque de puertos y `.env` generado). Elige una base que no choque.
3. Variables secretas en `.env.local.example`.
4. **Actualiza este AGENTS.md** (tabla de puertos, sección del servicio, comandos). Si no está aquí, el próximo agente no sabrá levantarlo.

Instrucciones específicas de cada app viven en `apps/<app>/AGENTS.md` o `README.md`.

## Render

El [Blueprint gratuito para el MCP](render.mcp.yaml) reutiliza web, MCP y broker sin modificar los puertos del stack local ni el despliegue de `render.yaml`. Solo Next escucha en `PORT`; MCP y broker usan sus puertos internos en loopback. Consulta [el despliegue del MCP](docs/render.md) para configurar OAuth y verificar el endpoint.
