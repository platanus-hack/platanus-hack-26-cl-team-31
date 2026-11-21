# AGENTS.md

Monorepo pnpm + Turborepo (Node 24, pnpm 10). Apps en `apps/*`, paquetes compartidos en `packages/*`. Infra local con Docker Compose.

## Mapa del repositorio

El MVP conserva MCP, server y broker como servicios separados, con bóvedas alojadas en Sideband. La columna de destino describe la **propuesta de unificación** que mantiene el ciclo de las solicitudes en el broker. Esa asignación sigue pendiente de decisión del equipo.

| Módulo | Qué hace hoy | Destino propuesto |
| --- | --- | --- |
| `apps/web` | Login OAuth, interfaz del titular y dashboard local `/demo`. | Conservar como interfaz. El dashboard y la CLI deben consumir las mismas operaciones. |
| `apps/mcp` | Expone las tools de Sideband a los asistentes y llama al broker con la identidad delegada. | Conservar como adaptador MCP común, incluidas las consultas a contactos. |
| `apps/broker`, `packages/broker` | La app expone HTTP y arranca el worker. El paquete implementa grants, solicitudes, aprobación del titular, almacenamiento y clientes. | Conservar como autoridad sobre permisos, solicitudes y entrega de resultados. |
| `apps/server` | API de coordinación con contactos, membresías, calendario, publicaciones y reuniones en PostgreSQL. Hoy también autentica tokens de la seed y expone su propio adaptador MCP. | Conservar bóvedas, grupos y reuniones. Retirar el directorio y las publicaciones. Migrar los consumidores y el historial antes de retirar `people.token_hash`, `availability_requests` y `apps/server/src/mcp.ts`. |
| `packages/protocol`, `packages/auth`, `packages/wake` | `protocol` define herramientas, grants y mensajes. `auth` implementa OAuth y JWT de servicio. `wake` envía avisos a agentes. | Conservar y reutilizar desde los servicios y sus clientes. |
| `apps/admin`, `packages/telemetry`, `packages/ops` | Panel y MCP de administración, instrumentación y esquema operativo de PostgreSQL. | Conservar para seguir las solicitudes por `requestId`. |
| `apps/demo` | Ejecuta Contactos de Ana desde la CLI y el dashboard. Ambos llaman al broker del worktree. Web aloja el receptor de avisos de los contactos en desarrollo. | Conservar el escenario y los datos de prueba. Los grants y las solicitudes ya se mantienen en el broker persistente. |
| `infra/`, `scripts/`, `packages/typescript-config`, `e2e/` | Preparación del entorno, comandos de desarrollo y ensayos, configuración TypeScript y pruebas del stack. | Conservar como soporte. Para probar OAuth, web, MCP y broker juntos, usar el [guion de scripts/demo](docs/demo.md). |

Las guías viven en `docs/`. [docs/poc](docs/poc/README.md) conserva el prototipo anterior al monorepo como referencia histórica.

## Modelo de producto

Un titular pregunta al agente de otro titular. El broker autoriza la pregunta según la categoría de información que el destinatario comparte con quien pregunta.

### Permisos

Un grant permite a una dirección Sideband preguntar sobre una categoría de información. Los permisos de un círculo compartido se suman a los grants directos.

- Una categoría es el tema de la información y una tool es la forma de preguntar. El catálogo `categories` (`packages/protocol/src/categories.ts`) lista las tools de cada categoría: Disponibilidad horaria (`availability`), Intereses (`interests`), Salud (`health`) y Preguntas abiertas (`general`).
- Un grant cubre todas las tools de su categoría y todos los campos de sus respuestas.
- `availability` e `interest_check` pertenecen a una sola categoría. `question` sirve a todas y lleva la suya en `args.category`. Sin categoría es una pregunta abierta (`general`).
- El broker no lee el texto de una `question`. El agente del destinatario recibe la categoría y responde solo sobre ella.
- El tipo es `Grant` (`packages/protocol/src/grants.ts`) y se guarda en `sideband.grants`. Un titular tiene un solo grant vivo por dirección y categoría.
- El titular los administra con `grants`, `setGrant` y `revokeGrant` del `OwnerPort` (`/v1/owner/grants`). Web los muestra por contacto en `/contacts`.
- Una categoría nueva es una entrada en `categories`. Una tool nueva solo hace falta para una respuesta con otra forma, y se agrega a su categoría.
- Los grants no se componen. Que Bob le dé un grant a Ana y Ana a Carla no le da a Carla nada de Bob.
- La política base son las categorías que comparten los miembros de un círculo y las que vienen marcadas al conectar: `availability` e `interests`. Vive en `basicSharing` (`packages/protocol/src/sharing.ts`).
- Un círculo es un conjunto con nombre (`Circle`, `/v1/owner/circles`). Solo quien lo creó invita, saca a otros y lo elimina, y cada invitado acepta antes de entrar. Mientras dos titulares estén en el mismo círculo se dan la política base. Web los administra en `/circles`.
- Los permisos de círculo se calculan al preguntar, en `sharingRule`, y no se guardan como grants. Salir borra la membresía y cierra las solicitudes pendientes que quedan sin permiso. Si ambos siguen en otro círculo, o existe un grant, el acceso se mantiene.

Pendiente, cada uno en su PR:

- Categoría pública. La tool `profile` pasará a leerse sin grant y a devolver `displayName` y `headline` desde `sideband.users`. Hoy no pertenece a ninguna categoría, así que toda solicitud `profile` se deniega.
- Vista `ops.v_grants` para el admin y borrar la tabla `sideband.sharing_rules`, que `ops.v_users` todavía lee.
- Pasar `memberships.can_ask` y `can_share` de `apps/server` a grants y retirar el directorio con `interests.audience`.
- `demo_profiles.interest_readers` solo alimenta el seed de `apps/demo`, que la convierte en grants.

### Contactos

- **Categoría.** El titular elige qué categorías comparte con cada contacto. Nunca ve tools ni campos.
- **Preguntas abiertas.** La categoría `general` cubre lo que no entra en otra. El agente del titular decide qué contesta. Queda fuera de lo básico.
- **Básico.** Al conectar vienen marcadas Disponibilidad horaria e Intereses.
- **Contacto.** Se conecta por invitación y es mutuo: al aceptar, ambos quedan como contactos. Cada uno elige qué categorías le comparte al otro (el que invita al enviar, el invitado al aceptar; lo básico viene marcado) y puede cambiarlo después sin avisar. Solo el titular acepta, desde la App Sideband; su agente responde `needs_owner`. Dejar de ser contactos borra la conexión y sus grants en ambos sentidos. Vive en `/contacts` (`contacts`, `setSharing`, `answerInvitation` y `removeFriend` del `OwnerPort`). `Sharing` es la lista de categorías que un titular le da a un contacto.

### Modelo decidido, por construir

- **Política por círculo.** Hoy todos los círculos usan la política base. Cuando haga falta otra, se guarda en el círculo.
- **Perfil.** Categoría pública: nombre y frase de presentación (`headline`) de cada titular, visibles para todo usuario con sesión.

### Vocabulario

Usa un término por concepto, en el código y en los textos.

| Término | En el código | Qué es |
| --- | --- | --- |
| Titular | `Owner`, `userId` | Persona que da los grants y responde por sus datos. «Dueño» en textos anteriores. |
| Agente | `Principal`, `agentId` | Asistente conectado que actúa por un titular con sus `scopes`. |
| Dirección Sideband | `Address` | Identificador `nombre@dominio` con el que otros titulares le escriben. |
| Solicitud | `AskInput`, `requestId` | Pregunta de un titular a otro con una tool. Termina en un `FinalOutcome`. |
| Tool | `ToolName` | Forma de preguntar: `availability`, `question`, `interest_check`. `profile` aún no pertenece a una categoría. |
| Grant | `Grant`, `GrantInput` | Permiso de un titular a una dirección para preguntar sobre una categoría. En la interfaz se llama «permiso». |
| Categoría | `Category`, `categories` | Tema de la información sobre el que responde un agente. Lista las tools que lo consultan. |
| Política base | `basicSharing` | Categorías que se dan los miembros de un círculo y que vienen marcadas al conectar. |
| Contacto | `contacts`, tool `connect` | Titular con el que otro aceptó conectarse. Ambos eligen qué categorías se dan como grants. |
| Círculo | `Circle` | Conjunto de titulares con un creador. Sus miembros se dan la política base mientras estén dentro. «Grupo» en textos anteriores. |
| Perfil | por construir | Nombre y frase de presentación de un titular, visibles para los demás usuarios. |
| Aviso | `WakeTarget`, `WakeNotice` | Notificación al agente del destinatario de que tiene una solicitud. |
| Bandeja | `InboxItem` | Solicitudes pendientes que lee el agente del destinatario. |

### Invariantes

Todo cambio en `packages/broker`, `packages/protocol` o `apps/mcp` conserva estas seis. Sus pruebas viven en `packages/broker/src/core/broker.test.ts`; si cambias una, cambia su prueba en el mismo PR.

1. La identidad del remitente sale del token. `AskInput` carece de campo de remitente.
2. Cuando la política deniega una pregunta, la denegación llega firmada y sin motivo, y la solicitud nunca despierta al destinatario.
3. La respuesta pasa por `filterResult` y sale solo con los campos permitidos.
4. Antes de entregar, `stillAuthorized` comprueba que el destinatario siga compartiendo la categoría de la solicitud. Si deja de compartirla, la entrega se bloquea.
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
| Usuarios de prueba | `fixtureUsers` de `@team-31/protocol` |
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
| MCP Sideband | `MCP_PORT` | `4100 + SLOT` |
| broker Sideband | `BROKER_PORT` | `4200 + SLOT` |
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

## Identidad Sideband

- OAuth en web usa `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` y `MCP_RESOURCE_URL`. El origen local `BETTER_AUTH_URL` se genera a partir de `WEB_PORT`. `pnpm bootstrap` prepara el esquema OAuth y genera las llaves faltantes en `.env.local`. Google se habilita al configurar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Sus pruebas usan `TEST_DATABASE_URL`. Consulta [Stack local de Sideband](docs/local-stack.md).
- El MCP remoto verifica los access tokens con `AUTH_ISSUER`, `AUTH_JWKS_URL` y `MCP_RESOURCE_URL`. `MCP_DEV_AUTH=1` habilita tokens de desarrollo fuera de producción.
- MCP, web y el servidor admin firman JWT para el broker con `MCP_SERVICE_PRIVATE_KEY`, `WEB_SERVICE_PRIVATE_KEY` y `ADMIN_SERVICE_PRIVATE_KEY` respectivamente. Web usa `BROKER_URL` para consultar la dirección Sideband. El broker verifica con `SERVICE_JWT_PUBLIC_KEYS` (JSON con las claves JWK públicas `mcp`, `web` y `admin`). `pnpm bootstrap` (`node infra/gen-keys.ts`) genera las que falten y agrega `admin` a un `SERVICE_JWT_PUBLIC_KEYS` existente.
- El JWT `iss=admin` (`mintServiceToken({ iss: "admin", sub: adminId, email, privateKey })`) solo vale en `/v1/admin/*` (`rewake`, `expire`, `revokeAgent` del `AdminPort`); el broker lo rechaza en `/v1/agent/*` y `/v1/owner/*`, y los JWT `mcp` y `web` no valen en `/v1/admin/*`. Sin `SERVICE_JWT_PUBLIC_KEYS.admin`, esas rutas responden 401.

## MCP Sideband

- `pnpm env:init` genera `MCP_RESOURCE_URL` con el puerto del worktree, y `AUTH_ISSUER` y `AUTH_JWKS_URL` con el puerto web. Ajusta los valores en `.env.local` si cambias el origen público.
- Usa `pnpm dev --filter @team-31/mcp` para iniciar solo MCP. Escucha en loopback por defecto y expone `GET /healthz`.
- La [guía del MCP](apps/mcp/README.md) cubre stdio de desarrollo y el perfil Compose `sideband`.

## WhatsApp Sideband

- Web recibe los avisos firmados de Kapso en `/api/kapso/webhook`, en el puerto web existente. Configura `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WHATSAPP_NUMBER` y `KAPSO_WEBHOOK_SECRET` solo en web; aplica `pnpm sideband:auth:migrate` en un worktree existente.
- Vincula el teléfono desde `/agents/connect/whatsapp`. La identidad sigue siendo el titular de Better Auth y el broker comparte las solicitudes con MCP. Setup y prueba: [docs/whatsapp.md](docs/whatsapp.md).
- Con `ANTHROPIC_API_KEY` en el proceso web, Claude interpreta texto libre después de verificar el vínculo. Sin esa variable siguen funcionando los comandos de texto.

## Broker Sideband

- Después de `pnpm bootstrap`, inicia solo el broker con `pnpm dev --filter @team-31/broker-service`. `pnpm env:init` actualiza worktrees existentes y genera `BROKER_PORT` y `BROKER_URL`.
- Conserva en `.env.local` las llaves que generó `pnpm bootstrap`. Configura `REQUEST_TTL_SECONDS` o `WAKE_RETRY_DELAYS_MS` para probar plazos y reintentos más cortos.
- `pnpm bootstrap` genera `BROKER_DATABASE_PASSWORD`, aplica las migraciones del broker y prepara el rol `sideband_broker`. El broker local se conecta con ese rol. `DATABASE_URL` del worktree se usa para migrar y para los demás servicios que ya la consumen. Para repetir la preparación de la base del broker, ejecuta `pnpm sideband:broker:migrate`.
- Ese mismo paso (`db:prepare`, que también corre al iniciar `pnpm dev` del broker) aplica las migraciones de `ops` después de `sideband.*` y del esquema OAuth, ejecuta `ops.refresh_views()` y otorga a `sideband_broker` `INSERT` en `ops.events` (permiso directo: el rol no puede ser miembro de `sideband_telemetry_writer`). Así el broker escribe su telemetría con su propio rol; `TELEMETRY_DATABASE_URL` la redirige a otra conexión.
- `BROKER_HOST` usa `127.0.0.1` por defecto. Para correrlo en Docker, compila con `pnpm build --filter @team-31/broker-service` y ejecuta `docker compose --env-file .env --env-file .env.local --profile sideband up -d broker`. Compose solo publica el puerto en loopback.
- `WAKE_ALLOW_INSECURE=1` permite avisos HTTP locales durante el desarrollo. Consulta [la guía del broker](apps/broker/README.md) para los detalles de Postgres, los avisos y el stream de actividad.

## Coordinación local entre N asistentes

1. Desde la raíz con Node 24, pnpm 10 y Docker, ejecuta `pnpm agents:up 3`. Déjalo abierto. Prepara el esquema, crea las identidades faltantes e inicia la API del worktree. Usa 2 para Ana y Bob o aumenta N para sumar participantes.
2. En otra terminal ejecuta `pnpm agents:demo 3`. Usa el mismo N o uno menor. Cada participante abre un proceso MCP y Eva, una identidad externa al grupo, comprueba la denegación.
3. Para ampliar un servicio que ya está corriendo, ejecuta `pnpm agents:seed 5`. Para usar clientes interactivos, sigue [las instrucciones de MCP](apps/mcp/README.md).

El servidor usa `DATABASE_URL`. Cada adaptador MCP (`apps/server/dist/mcp.js`) recibe `COORDINATION_API_URL` y su propio `AGENT_TOKEN` de un archivo privado en `.agents-local/`. Conserva esa carpeta junto a la base para volver a abrir las sesiones. PostgreSQL guarda permisos, disponibilidad, publicaciones y encuentros. El permiso de grupo se evalúa en SQL dentro de `apps/server/src/availability.ts`. `pnpm test` usa la base separada `app_test`.

Ctrl+C detiene la API del host y `pnpm infra:down` detiene PostgreSQL conservando el volumen. Después de preparar el esquema, las cuentas y el build, también puedes iniciar la API en segundo plano con `docker compose --profile agents up -d coordination` con el puerto del host libre. Para detener ese stack usa `docker compose --profile agents down`.

En el dashboard de desarrollo `/demo`, **Fútbol del sábado** llama por HTTP a `apps/server` con la identidad de la seed y a Ollama por loopback (`DEMO_MODEL_URL`, modelo `qwen3:4b-instruct` por defecto). Para arrancar Ollama, elige el perfil Compose `demo-model` o un proceso nativo. Los comandos están en el [README](README.md).

## Qué ejecuta apps/demo · Contactos de Ana

Desde un worktree preparado con `pnpm bootstrap`, inicia web y broker en el host con `pnpm with-env env WAKE_ALLOW_INSECURE=1 pnpm exec turbo run dev --filter @team-31/broker-service --filter @team-31/web`. En otra terminal, `pnpm agents:contacts:seed` prepara los 15 perfiles ficticios y registra sus direcciones, grants iniciales y avisos. El comando respeta los grants y conexiones existentes cuando se repite.

1. Con Claude Code autenticado, ejecuta `corepack pnpm with-env corepack pnpm agents:runtime-demo "¿A alguien le interesa la cerámica?"` o pregunta desde **Contactos de Ana** en `/demo`. Ambos usan [runContactSession](apps/demo/src/contact-session.mjs) y leen la agenda de Ana de PostgreSQL.
2. Claude usa el MCP stdio de la demo con `list_contacts`, `ask_contact` y `await_contact`. El MCP llama a `BROKER_URL` con la identidad de Ana. [apps/broker](apps/broker/src/index.ts) atiende HTTP y ejecuta el worker. [packages/broker](packages/broker/src/core/broker.ts) evalúa las reglas y conserva el estado en PostgreSQL, incluso después de cerrar el chat.
3. Una denegación cierra la solicitud antes del aviso. Para un `interest_check` permitido, el broker envía un webhook firmado a `/api/demo/contact-wake/<id>` en web. El agente del contacto lee su JSON de prueba con Claude Code y responde a través del broker. El receptor usa la misma dirección en cada sesión. [Receptor](apps/demo/src/contact-wake.mjs) · [Relaciones y datos de prueba](apps/mcp/README.md#buscar-entre-los-agentes-de-la-agenda)

## Pruebas de punta a punta de Sideband

- [`e2e/`](e2e/README.md) prueba el stack local con clientes MCP del SDK. La suite se ejecuta cuando se define `E2E_MCP_URL` y usa `BROKER_URL` y `WEB_SERVICE_PRIVATE_KEY` de un worktree de prueba.
- `E2E_AUTH_MODE` vale `dev` por defecto. Para `oauth`, pasa los access tokens de cuentas de prueba en `E2E_OAUTH_TOKENS`. `E2E_ISOLATION_COUNT` controla cuántas solicitudes simultáneas se envían (80 por defecto).
- El broker debe ejecutarse en el host para llamar a los receptores falsos, que usan un puerto efímero en loopback. Configura `WAKE_ALLOW_INSECURE=1`, `REQUEST_TTL_SECONDS=20` y `WAKE_RETRY_DELAYS_MS=0,0`.

## 🔭 Todo debe ser monitoreable por el admin (obligatorio)

Sideband se depura en producción con `apps/admin` (panel + MCP de administración). Diseño: [docs/admin.md](docs/admin.md). Cualquier funcionalidad nueva o modificada **en el mismo PR** debe:

1. **Emitir telemetría** con `@team-31/telemetry` (`emit`, `span`, `error`). Cada transición de estado, llamada externa, decisión de permisos o de autenticación y cada error genera un evento. Si el evento no existe, decláralo en `packages/telemetry/src/catalog.ts` con su esquema. Incluye `requestId`, `userId` y `agentId` cuando existan.
2. **Nunca tragarse un error**: `catch` → `telemetry.error(operación, error)` y devolver el `errorId` (encabezado `X-Error-Id`). Nada de `console.error` suelto.
3. **Propagar la traza**: toda llamada HTTP interna usa `tracedFetch` (encabezado `traceparent`) y todo servidor Hono usa `honoTelemetry`.
4. **Exponer su estado al admin**: si agregas o cambias una tabla o una columna, crea o actualiza su vista redactada `ops.v_*` en `packages/ops/sql/` (nueva migración numerada). Si es una entidad nueva, agrega su lectura a `AdminQueries` (`apps/admin/shared/queries.ts`) y, si aplica, su página en el panel y su tool en el MCP admin.
5. **No filtrar datos**: nunca pongas en eventos, logs ni vistas tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result` ni texto libre de terceros. El payload real solo se ve en `ops.v_request_payloads`, con un motivo y auditoría.
6. **Servicio nuevo**: emite `service.started` y `service.heartbeat` y expone `GET /healthz`.
7. **Mutaciones operativas** (reintentar, expirar, revocar…) se exponen en el `AdminPort` del broker, nunca como `UPDATE` directo desde el admin.

En la descripción del PR agrega una línea **«Cómo se ve en el admin:»** con el evento, la vista o la pantalla donde se observa el cambio.

Todos los servicios están instrumentados (ADM-07). Al tocar uno, extiende su telemetría en el mismo lugar:

| Servicio | Dónde | Eventos |
| --- | --- | --- |
| broker HTTP (`broker`) y worker (`worker`) | `apps/broker/src/telemetry.ts`, `http/server.ts`, `http/auth.ts` | `http.request`, `auth.service_jwt.rejected`, `http.rate_limited`, `error` (con `X-Error-Id`) y latido de cada servicio |
| core del broker | `packages/broker/src/core/events.ts` (`BrokerDeps.telemetry`, opcional) | `broker.policy.evaluated`, `broker.request.created`/`status_changed`/`closed`, `broker.reply.rejected`, `broker.owner.decided`, `admin.action`, `auth.scope.denied`. Se registran dentro de la transacción y se emiten solo si confirma |
| avisos | `packages/wake` (`createWaker({ telemetry })`, inyectada) | `wake.attempt` (span por intento) y `wake.exhausted` |
| MCP | `apps/mcp/src/http.ts`, `tools/result.ts`, `events.ts` | `http.request`, `auth.token.verified`/`rejected`, `mcp.tool.call` (también `events/*`), `auth.scope.denied`. En stdio la telemetría nunca va a stdout |
| web | `apps/web/src/lib/telemetry.ts` (singleton), `instrumentation.ts` | `http.request` (`observeRoute`), `auth.oauth.consent`, `error` (también `onRequestError`) |
| coordinación | `apps/server/src/http.ts` | `http.request`, `coordination.tool.call`, `auth.token.rejected`, `error` |

Las llamadas internas al broker usan `tracedFetch` (opción `fetch` de `createAgentClient`/`createOwnerClient`), así que una solicitud por el MCP deja en `ops.events` spans de `mcp` y `broker` con el mismo `trace_id` y `request_id` (prueba en `e2e/src/trace.test.ts`, que no requiere el stack).

## Admin y observabilidad

- App en `apps/admin`: SPA React + Vite + shadcn (preset Nova, Radix) en `src/`, servidor Hono (API, auth y MCP admin) en `server/` y contrato compartido en `shared/`. Instrucciones en [apps/admin/AGENTS.md](apps/admin/AGENTS.md).
- `pnpm dev --filter @team-31/admin` levanta la SPA en `ADMIN_PORT` (Vite, con proxy de `/api` y `/mcp`) y el servidor admin en `ADMIN_API_PORT` (`tsx watch`). Acceso por `ADMIN_OPERATORS`/`ADMIN_VIEWERS` (Google con `ADMIN_GOOGLE_CLIENT_ID/SECRET`) o, fuera de producción, `ADMIN_DEV_AUTH=1` y `POST /api/admin/dev-login`. Esquema `admin` en producción: `pnpm with-env pnpm --filter @team-31/admin admin:auth:migrate`. Compose: servicio `admin` del perfil `sideband` (todo en `ADMIN_PORT`, solo loopback). Detalles en [apps/admin/README.md](apps/admin/README.md).
- Esquema `ops` en Postgres (`packages/ops`): `ops.events` (telemetría) y vistas redactadas `ops.v_*`. `pnpm bootstrap` lo migra (vía `pnpm sideband:broker:migrate`, ver Broker Sideband). A mano: `pnpm --filter @team-31/ops build && pnpm with-env pnpm --filter @team-31/ops migrate`. `applyOpsMigrations` siempre termina con `ops.refresh_views()`, que crea las vistas cuyas tablas ya existen: vuelve a migrar después de crear tablas nuevas.
- Telemetría: `@team-31/telemetry` (`createTelemetry`, `tracedFetch`) y `@team-31/telemetry/hono` (`honoTelemetry`). Instrumentación en 5 líneas y catálogo en [packages/telemetry/README.md](packages/telemetry/README.md). `TELEMETRY_SINK=postgres|console|off`; `postgres` usa `TELEMETRY_DATABASE_URL` o `DATABASE_URL`. En dev los servicios escriben en `ops.events` del worktree; Compose pasa ambas variables a broker, MCP y coordinación.
- Variables `ADMIN_*` y `TELEMETRY_*` en `.env.local.example`.
- UI: usa la skill `shadcn` (`.agents/skills/shadcn`, enlazada en `.claude/skills`) y el MCP `shadcn` de `.mcp.json`. Componentes con `pnpm dlx shadcn@latest add <componente>` desde `apps/admin`.

## Docker: demo y tests efímeros

Sin Node local, sólo Docker. Cada corrida usa un stack propio (Postgres en tmpfs, sin puertos en el host) y lo borra al terminar, así que no choca con tu stack de dev ni con otros worktrees.

- `pnpm docker:demo [N]` — esquema + identidades + demo MCP con N participantes (default 3).
- `pnpm docker:test` — tests del stack de coordinación (`apps/server`, `apps/scale`) contra `app_test` en paralelo con la demo end-to-end y el escenario de carga `smoke`. ~25 s con la imagen en caché. El resto del monorepo se prueba con `pnpm test` en el host.

Imagen en `Dockerfile`, recortada con `turbo prune` a `apps/server`, `apps/scale` y `apps/mcp` (sus dependencias sólo se reinstalan si cambian los `package.json` o el lockfile, y el build usa la caché de turbo); servicios `demo`/`test`/`scale` en `docker-compose.yml`; override aislado en `infra/docker/compose.isolated.yml`.

## Carga + invariantes (`apps/scale`)

`pnpm scale:run <escenario> [--agents N] [--iterations N | --duration SEG] [--concurrency N] [--seed S] [--mcp [K]]`

Levanta un stack aislado (como `docker:demo`), siembra un mundo determinista y lanza N agentes virtuales contra la API. Cada respuesta y la base final se verifican contra invariantes de correctitud y seguridad. Sale con código ≠ 0 si hay violaciones. La tabla (p50/p95/p99 por tool, req/s) se imprime al final, y el JSON y las muestras de `docker stats` quedan en `.scale-results/` (gitignored).

- Escenarios: `smoke` (10 agentes), `hundred` (100), `contention` (60 en un solo grupo con encuentros de 6 a 20 personas) y `tenk` (10.000, para probar la siembra).
- `--mcp [K]`: los primeros K agentes (o todos) usan adaptadores MCP stdio reales en vez de HTTP directo. Cada uno es un proceso Node de ~37 MB, así que 100 llegan a ~4 GB.
- Sin Docker, contra tu stack de dev: `pnpm with-env node apps/scale/src/run.mjs smoke --reset`. **`--reset` borra toda la base de coordinación**. Sólo siembra: `pnpm with-env node apps/scale/src/seed.mjs <escenario> --reset`.

**Formato de escenario** (`apps/scale/scenarios/<nombre>.json`). Las claves que omitas toman los `DEFAULTS` de `apps/scale/src/world.mjs`:
`seed`, `agents`, `outsiders` (personas sin grupo), `groups {count, perAgent:[min,max], skew}`, `permissions {canAsk, canShare, volatile}` (probabilidades por membresía; las "volátiles" revocan y restauran `can_share` durante la corrida), `calendar {start, days, slotsPerDay, slotMinutes, busy, halfOffset}`, `interests {vocabulary, perAgent, public}`, `meetings {participants, slots, accept}`, `foreign` (prob. de apuntar a grupos/personas ajenas), `mix` (pesos por acción: `availability_check`, `request_get`, `interest_*`, `meeting_propose`, `meeting_inbox`, `meeting_get`, `group_permission`, `probe`), `run {iterations | durationSec, concurrency, thinkMs:[min,max], drainRounds}`. Misma semilla → mismo mundo (`worldHash` en el JSON). Los tokens son aleatorios y se escriben con permisos 0600 en un directorio temporal, nunca en el repo.

**Agregar un escenario**: crea el JSON. **Agregar un invariante**: llama a `inv.check("nombre", ok, reqId, detalle)` en `apps/scale/src/run.mjs` (sobre respuestas) o agrega una consulta a `DB_CHECKS` en `apps/scale/src/invariants.mjs` (filas que violan; vacío = ok). Usa `inv.warn` sólo para desvíos conocidos del servidor que todavía no se arreglan. Hoy hay uno, `inbox_only_pending`: `meeting_inbox` puede devolver un encuentro recién cerrado por lectura no repetible entre sentencias.

## Comandos

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`. Antes de dar algo por listo: `pnpm lint && pnpm typecheck` (y `pnpm test` si aplica).

`pnpm lint` solo cubre `apps/admin` y `apps/web`. El resto depende de `pnpm typecheck` y `pnpm test`, y `apps/demo` queda fuera de `typecheck`.

Las validaciones se ejecutan en el worktree local. El CI del repo del hackathon corre build y typecheck en cada push a `main`, sin disparar deploys.

## ⚠️ Al agregar infra o configuración nueva

Si agregas un servicio (Redis, cola, etc.), una app que expone un puerto, o una variable de entorno, **en el mismo PR**:

1. Servicio en `docker-compose.yml` con puerto `${<SERVICIO>_PORT}` (nunca fijo).
2. Puerto `BASE + SLOT` en `scripts/env-init.sh` (bloque de puertos y `.env` generado). Elige una base que no choque.
3. Variables secretas en `.env.local.example`.
4. **Actualiza este AGENTS.md** (tabla de puertos, sección del servicio, comandos). Si no está aquí, el próximo agente no sabrá levantarlo.

Instrucciones específicas de cada app viven en `apps/<app>/AGENTS.md` o `README.md`.

## Render

El [Blueprint gratuito para el MCP](render.mcp.yaml) reutiliza web, MCP y broker sin modificar los puertos del stack local ni el despliegue de `render.yaml`. Solo Next escucha en `PORT`; MCP y broker usan sus puertos internos en loopback. Consulta [el despliegue del MCP](docs/render.md) para configurar OAuth y verificar el endpoint.
