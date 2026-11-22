# AGENTS.md

Monorepo pnpm + Turborepo (Node 24, pnpm 10). Apps en `apps/*`, paquetes compartidos en `packages/*`. Infra local con Docker Compose.

## Mapa del repositorio

El MVP conserva MCP, server y broker como servicios separados, con bóvedas alojadas en Sideband. La columna de destino describe la **propuesta de unificación** que mantiene el ciclo de las solicitudes en el broker. Esa asignación sigue pendiente de decisión del equipo.

| Módulo | Qué hace hoy | Destino propuesto |
| --- | --- | --- |
| `apps/web` | Login OAuth, interfaz del titular y dashboard local `/demo`. | Conservar como interfaz. El dashboard y la CLI deben consumir las mismas operaciones. |
| `apps/mcp` | Expone las tools de Sideband a los asistentes y llama al broker con la identidad delegada. | Conservar como adaptador MCP común, incluidas las consultas a contactos. |
| `apps/broker`, `packages/broker`, `packages/broker-client` | La app expone HTTP y arranca el worker. El paquete implementa grants, solicitudes, aprobación del titular, almacenamiento. `broker-client` implementa los clientes HTTP y el runtime del titular. | Conservar como autoridad sobre permisos, solicitudes y entrega de resultados. |
| `apps/server` | API de coordinación con contactos, membresías, calendario, publicaciones y reuniones en PostgreSQL. Hoy también autentica tokens de la seed y expone su propio adaptador MCP. | Conservar bóvedas, grupos y reuniones. Retirar el directorio y las publicaciones. Migrar los consumidores y el historial antes de retirar `people.token_hash`, `availability_requests` y `apps/server/src/mcp.ts`. |
| `packages/protocol`, `packages/auth`, `packages/wake` | `protocol` define herramientas, grants y mensajes. `auth` implementa OAuth y JWT de servicio. `wake` envía avisos a agentes. | Conservar y reutilizar desde los servicios y sus clientes. |
| `apps/admin`, `packages/telemetry`, `packages/ops` | Panel y MCP de administración, instrumentación y esquema operativo de PostgreSQL. | Conservar para seguir las solicitudes por `requestId`. |
| `apps/redteam` | Harness red team / blue team del broker: catálogo de ataques contra cada guardrail (`política`, `stillAuthorized`, sanitize, nonce, firma, avisos, telemetría) con veredictos `contained`/`known_gap`. Corre contra el núcleo real en memoria y, con `pnpm --filter @team-31/redteam live`, contra el broker HTTP del worktree. Un `known_gap` que deje de fugarse hace fallar el test: mover el caso a `contained` y celebrar. | Conservar como pruebas de seguridad continuas; los gaps documentados son la deuda a cerrar. |
| `packages/agent-flow` | Visualizador del flujo entre agentes y de la red (React, sin dependencias) y el único mapeo de la telemetría a `FlowEvent`. Lo usan la landing, `/embed/flujo` y la página **Flujo** del admin. | Conservar. Guía: [docs/agent-flow.md](docs/agent-flow.md). |
| `apps/demo` | Ejecuta Contactos de Ana desde la CLI y el dashboard. Ambos llaman al broker del worktree. Web aloja el receptor de avisos de los contactos en desarrollo. | Conservar el escenario y los datos de prueba. Los grants y las solicitudes ya se mantienen en el broker persistente. |
| `infra/`, `scripts/`, `packages/typescript-config`, `e2e/` | Preparación del entorno, comandos de desarrollo y ensayos, configuración TypeScript y pruebas del stack. | Conservar como soporte. Para probar OAuth, web, MCP y broker juntos, usar el [guion de scripts/demo](docs/demo.md). |

Las guías viven en `docs/`. [docs/poc](docs/poc/README.md) conserva el prototipo anterior al monorepo como referencia histórica.

## Modelo de producto

Un titular pregunta al agente de otro titular. El broker autoriza la pregunta según la categoría de información que el destinatario comparte con quien pregunta.

### Permisos

Una sola regla decide qué ve otro titular: si puede leer una categoría de la bóveda, también puede preguntar por ella. La regla es `canReadVault` del store (`packages/broker/src/store/postgres/vault-store.ts`): manda la decisión individual sobre el contacto; sin ella, lee una categoría pública cualquier usuario de Sideband y una privada el contacto con una etiqueta permitida. `sharingRule` (`packages/broker/src/core/grants.ts`) pregunta eso mismo por la categoría de la solicitud y suma los permisos de un círculo compartido.

- Una categoría es el tema de la información y una tool es la forma de preguntar. El catálogo `categories` (`packages/protocol/src/constants.ts`) lista las tools de cada categoría: Disponibilidad horaria (`availability`), Intereses (`interests`), Salud (`health`) y Preguntas abiertas (`general`).
- Leer una categoría cubre todas las tools que preguntan por ella y todos los campos de sus respuestas.
- `availability` e `interest_check` pertenecen a una sola categoría. `question` sirve a todas y lleva la suya en `args.category`. Sin categoría es una pregunta abierta (`general`).
- El broker no lee el texto de una `question`. El agente del destinatario recibe la categoría y responde solo sobre ella.
- Lo que un titular comparte con un contacto se guarda en la bóveda: etiquetas permitidas (`set_tag`), decisión individual (`set_member`, `clear_member`) y visibilidad. Web lo muestra por contacto en `/contacts` y por categoría en `/vault`.
- `sideband.grants` quedó congelada. `grants`, `setGrant` y `revokeGrant` del `OwnerPort` (`/v1/owner/grants`) siguen para los guiones de la demo y las pruebas: un grant vivo todavía abre la categoría por defecto de su ID. Web, MCP y WhatsApp ya no escriben grants.
- Para agregar una categoría, declara su nombre en `categoryNames` y su etiqueta y tools en `categories` de `packages/protocol/src/constants.ts`. Contactos recorre el catálogo y necesita el texto de ayuda en `contacts/sharing.tsx`. En WhatsApp actualiza el texto de denegación y el vocabulario de invitaciones en `whatsapp/commands.ts`, y la guía del clasificador en `whatsapp/claude.ts`. Una tool nueva solo hace falta para una respuesta con otra forma, y se agrega a su categoría.
- Los permisos no se componen. Que Bob le comparta algo a Ana y Ana a Carla no le da a Carla nada de Bob.
- La política base son las categorías que comparten los miembros de un círculo y las que vienen marcadas al conectar: `availability` e `interests`. Vive en `basicSharing` (`packages/protocol/src/sharing.ts`).
- Un círculo es un conjunto con nombre (`Circle`, `/v1/owner/circles`). Solo quien lo creó invita, saca a otros y lo elimina, y cada invitado acepta antes de entrar. Mientras dos titulares estén en el mismo círculo se dan la política base. Web los administra en `/circles`.
- Los permisos de círculo se calculan al preguntar, en `sharingRule`, y no abren la bóveda. Salir borra la membresía y cierra las solicitudes pendientes que quedan sin permiso. Si ambos siguen en otro círculo, o el titular comparte la categoría, el acceso se mantiene.

Pendiente, cada uno en su PR:

- Categoría pública. La tool `profile` pasará a leerse sin grant y a devolver `displayName` y `headline` desde `sideband.users`. Hoy no pertenece a ninguna categoría, así que toda solicitud `profile` se deniega.
- Vista `ops.v_grants` para el admin y borrar la tabla `sideband.sharing_rules`, que `ops.v_users` todavía lee.
- Pasar `memberships.can_ask` y `can_share` de `apps/server` a grants y retirar el directorio con `interests.audience`.
- `demo_profiles.interest_readers` solo alimenta el seed de `apps/demo`, que la convierte en grants.

### Contactos

- **Categoría.** El titular elige qué categorías comparte con cada contacto. Nunca ve tools ni campos.
- **Preguntas abiertas.** La categoría `general` cubre lo que no entra en otra. El agente del titular decide qué contesta. Queda fuera de lo básico.
- **Básico.** Al conectar vienen marcadas Disponibilidad horaria e Intereses.
- **Contacto.** Se conecta por invitación y es mutuo: al aceptar, ambos quedan como contactos. Cada uno elige qué categorías le comparte al otro y puede cambiarlas después. El titular acepta desde Contactos, WhatsApp vinculado o su agente. El agente necesita `sideband:reply` y `sideband:accept` y envía las categorías elegidas en `share`; mientras espera al titular responde `needs_owner`. Dejar de ser contactos borra la conexión y lo que se compartían en ambos sentidos. Vive en `/contacts` (`contacts`, `setSharing`, `answerInvitation` y `removeContact` del `OwnerPort`). `Sharing` es la lista de categorías que un titular le da a un contacto.
- **Etiqueta.** Cada titular tiene sus etiquetas (`Tag` en `packages/protocol/src/sharing.ts`): nombre único sin distinguir mayúsculas, color de una paleta fija y las categorías que comparte, que son las categorías por defecto de la bóveda que la etiqueta abre (las mismas filas que escribe `set_tag`). Parte con Amigo, Familia y Trabajo (IDs `friend`, `family`, `work`, en `defaultTags`) y puede crear, renombrar, recolorear, cambiar categorías y borrar cualquiera (`tags`, `createTag`, `updateTag`, `deleteTag` del `OwnerPort`).
- **Etiquetas de un contacto.** Un contacto lleva cero o más etiquetas (`setContactTags`) y lee al momento la unión de lo que abren: ponerlas, quitarlas o cambiar sus categorías no escribe nada por contacto. `setSharing` deja una decisión individual solo en las categorías donde lo elegido difiere de lo que dicen la visibilidad y las etiquetas; esa decisión prevalece hasta que el titular elige de nuevo lo que dicen las etiquetas. Al invitar y al aceptar se eligen etiquetas (`tags`); sin `share`, se ofrece su unión.
- **Categorías de la bóveda.** Cada titular parte con una categoría por cada una del catálogo, con el mismo ID (`defaultVaultCategories` en `packages/protocol/src/constants.ts`), y puede crear las suyas. Cada categoría lleva una descripción que cuenta de qué trata (`describe` de `VaultChange`). El agente del titular lista las categorías con `sideband_vault_catalog` y con `categoryId` lee los datos de una.
- **Catálogo visible.** Cualquier usuario de Sideband lista las categorías de otro titular con nombre, descripción y visibilidad (`sideband_vault_access`), nunca sus datos; `canRead` indica si puede abrirlas. Una categoría pública (`set_visibility`) la lee cualquier usuario de Sideband, sea o no contacto; una privada necesita un contacto con etiqueta permitida o permiso individual. La decisión individual (`set_member`) cierra una pública a un contacto. Nacen privadas salvo que el titular las cree públicas (`visibility` de `create`). Una categoría por defecto es la misma del catálogo: quien lee «Disponibilidad horaria» puede preguntar por `availability`, y una pública deja preguntar a cualquier usuario de Sideband.
- **Bóveda por etiqueta.** Una categoría de la bóveda se lee por las etiquetas permitidas (`set_tag`); la decisión individual (`set_member`) prevalece. Borrar una etiqueta la quita de contactos y permisos.
- **Agente y etiquetas.** El agente lista y organiza etiquetas (`sideband_tags`, `sideband_tag_change`, scope `sideband:vault`). No elige las categorías de una etiqueta, pero ponérsela o quitársela a un contacto le abre o cierra lo que esa etiqueta comparte. Se guardan en `sideband.tags` y `sideband.contact_tags`; telemetría `broker.tag.changed` y `broker.contact.tagged`.

### Modelo decidido, por construir

- **Política por círculo.** Hoy todos los círculos usan la política base. Cuando haga falta otra, se guarda en el círculo.
- **Perfil.** Categoría pública: nombre y frase de presentación (`headline`) de cada titular, visibles para todo usuario con sesión.

### Vocabulario

Usa un término por concepto, en el código y en los textos.

| Término | En el código | Qué es |
| --- | --- | --- |
| Titular | `Owner`, `userId` | Persona que decide qué comparte y responde por sus datos. «Dueño» en textos anteriores. |
| Agente | `Principal`, `agentId` | Asistente conectado que actúa por un titular con sus `scopes`. |
| Dirección Sideband | `Address` | Identificador `nombre@dominio` con el que otros titulares le escriben. |
| Solicitud | `AskInput`, `requestId` | Pregunta de un titular a otro con una tool. Termina en un `FinalOutcome`. |
| Tool | `ToolName` | Forma de preguntar: `availability`, `question`, `interest_check`. `profile` aún no pertenece a una categoría. |
| Grant | `Grant`, `GrantInput` | Permiso anterior a la regla única, de un titular a una dirección sobre una categoría. Congelado: lo usan los guiones de la demo y las pruebas. |
| Categoría | `Category`, `categories` | Tema de la información sobre el que responde un agente. Lista las tools que lo consultan. |
| Política base | `basicSharing` | Categorías que se dan los miembros de un círculo y que vienen marcadas al conectar. |
| Contacto | `contacts`, tool `connect` | Titular con el que otro aceptó conectarse. Ambos eligen qué categorías se comparten. |
| Etiqueta | `Tag`, `TagId` | Marca de un titular para sus contactos, con nombre, color y categorías. Un contacto puede llevar varias. «Grupo privado» en textos anteriores. |
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
| Llamar al broker | `createAgentClient` y `createOwnerClient` de `@team-31/broker-client`. El export anterior `@team-31/broker/client` sigue disponible por compatibilidad |
| Firmar o verificar un JWT de servicio | `mintServiceToken` y `verifyServiceToken` de `@team-31/auth/service` |
| Verificar un access token OAuth | `createMcpGuard` de `@team-31/auth/resource` |
| Enviar un aviso o verificar su firma | `createWaker` y `verifyWebhookSignature` de `@team-31/wake` |
| Eventos, errores y `fetch` con traza | `@team-31/telemetry` |
| Generar llaves | `infra/gen-keys.ts` |
| Usuarios de prueba | `fixtureUsers` de `@team-31/protocol` |
| Receptor falso de avisos | `startFakeReceivers` de `e2e/src/fake-receivers.ts` |
| Base Postgres propia en un test | `createTestDatabase` de `@team-31/test-db` (crea desde `TEST_DATABASE_URL` y `drop()` espera a que cierren los backends) |

- **La segunda copia se mueve.** Cuando dos módulos necesitan lo mismo, mueve el original a `packages/*` en ese PR e importa desde ambos. Para limitar solicitudes por ventana fija usa `@team-31/auth/rate-limit`; para validar una JWK Ed25519 usa los esquemas de `@team-31/auth/service`.
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

- Cada titular puede tener un solo agente activo (el `agentId` del cliente OAuth). Para conectar otro, desconecta primero el actual en **Agentes**. Las sesiones del mismo cliente comparten identidad. Los canales como WhatsApp son independientes.

- `pnpm env:init` genera `MCP_RESOURCE_URL` con el puerto del worktree, y `AUTH_ISSUER` y `AUTH_JWKS_URL` con el puerto web. Ajusta los valores en `.env.local` si cambias el origen público.
- Usa `pnpm dev --filter @team-31/mcp` para iniciar solo MCP. Escucha en loopback por defecto y expone `GET /healthz`.
- La [guía del MCP](apps/mcp/README.md) cubre stdio de desarrollo y el perfil Compose `sideband`.

## Mensajes en lenguaje natural

MCP y WhatsApp comparten `@team-31/message-flow`. LangGraph ejecuta las transiciones, LangChain usa la API de Claude para interpretar texto y el broker valida cada operación. Con `ANTHROPIC_API_KEY` en cada proceso se habilita la entrada conversacional del canal. `MESSAGE_FLOW_MODEL` elige el modelo y `MESSAGE_FLOW_DATABASE_URL` permite usar credenciales dedicadas para la base de turnos (por defecto `DATABASE_URL`). Migrar broker y ops antes de activar los canales. Ver [flujos, pruebas y despliegue](docs/message-routing.md).

## WhatsApp Sideband

- Web recibe los avisos firmados de Kapso en `/api/kapso/webhook`, en el puerto web existente. Configura `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WHATSAPP_NUMBER` y `KAPSO_WEBHOOK_SECRET` solo en web; aplica `pnpm sideband:auth:migrate` en un worktree existente.
- `WHATSAPP_NOTICE_SECRET` (`whsec_…`, lo genera `pnpm bootstrap`) firma los avisos del broker a `/api/whatsapp/notice/<vínculo>`. Al confirmar el vínculo, web registra el canal `whatsapp` en el broker y la respuesta llega al teléfono sin `estado`. Fuera de la ventana de 24 horas de WhatsApp queda como entrega pendiente y sale con el siguiente mensaje del titular.
- Vincula el teléfono desde `/agents/connect/whatsapp`. La identidad sigue siendo el titular de Better Auth y el broker comparte las solicitudes con MCP. Setup y prueba: [docs/whatsapp.md](docs/whatsapp.md).
- Con `ANTHROPIC_API_KEY` en el proceso web, Claude interpreta texto libre después de verificar el vínculo. Sin esa variable siguen funcionando los comandos de texto.
- `pnpm agents:cast:seed <tu dirección>` agrega a tu cuenta cinco contactos ficticios de `apps/demo/src/cast.json`, con lo que te comparte cada uno, su bóveda «Salud» y un agente con aviso en `/api/demo/cast-wake/<id>` que responde `interest_check` y `availability`. `/demo/elenco` muestra sus perfiles públicos, sus datos privados y quién puede pedir cada uno.

## Broker Sideband

- Después de `pnpm bootstrap`, inicia solo el broker con `pnpm dev --filter @team-31/broker-service`. `pnpm env:init` actualiza worktrees existentes y genera `BROKER_PORT` y `BROKER_URL`.
- Conserva en `.env.local` las llaves que generó `pnpm bootstrap`. Configura `REQUEST_TTL_SECONDS` o `WAKE_RETRY_DELAYS_MS` para probar plazos y reintentos más cortos.
- `pnpm bootstrap` genera `BROKER_DATABASE_PASSWORD`, aplica las migraciones del broker y prepara el rol `sideband_broker`. El broker local se conecta con ese rol. `DATABASE_URL` del worktree se usa para migrar y para los demás servicios que ya la consumen. Para repetir la preparación de la base del broker, ejecuta `pnpm sideband:broker:migrate`.
- Ese mismo paso (`db:prepare`, que también corre al iniciar `pnpm dev` del broker) aplica las migraciones de `ops` después de `sideband.*` y del esquema OAuth, ejecuta `ops.refresh_views()` y otorga a `sideband_broker` `INSERT` en `ops.events` (permiso directo: el rol no puede ser miembro de `sideband_telemetry_writer`). Así el broker escribe su telemetría con su propio rol; `TELEMETRY_DATABASE_URL` la redirige a otra conexión.
- `BROKER_HOST` usa `127.0.0.1` por defecto. Para correrlo en Docker, ejecuta `docker compose --env-file .env --env-file .env.local --profile sideband up -d --build broker`. Compose compila el servicio dentro de la imagen sin montar el worktree y solo publica el puerto en loopback.
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

## Red team / blue team del broker

[`apps/redteam`](apps/redteam/README.md) ataca cada guardrail con ataques dirigidos (sin grant, categoría cruzada, canarios ofuscados, reutilización de nonce, sobre falsificado…) y comprueba, caso por caso, que el flujo no entregó lo prohibido. Corre contra el núcleo real del broker en memoria (determinista, sin stack) dentro de `pnpm test`, contra el broker HTTP vivo con `pnpm --filter @team-31/redteam live`, y contra los agentes reales del demo con `pnpm --filter @team-31/redteam agents`. El juez LLM (`src/judge.ts`, solo con `pnpm --filter @team-31/redteam judge` y `ANTHROPIC_API_KEY`) relee lo entregado y mide si un redactor LLM cerraría los gaps. Los veredictos `known_gap` documentan vectores que hoy pasan; cerrar uno exige mover el caso a `contained` en el mismo PR que lo arregle.

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
| core del broker | `packages/broker/src/core/events.ts` (`BrokerDeps.telemetry`, opcional) | `broker.policy.evaluated`, `broker.request.created`/`status_changed`/`closed`, `broker.reply.rejected`, `broker.owner.decided`, `broker.agent.connected`/`revoked`, `admin.action`, `auth.scope.denied`. Se registran dentro de la transacción y se emiten solo si confirma |
| avisos | `packages/wake` (`createWaker({ telemetry })`, inyectada) | `wake.attempt` (span por intento) y `wake.exhausted` |
| MCP | `apps/mcp/src/http.ts`, `tools/result.ts`, `events.ts` | `http.request`, `auth.token.verified`/`rejected`, `mcp.tool.call` (también `events/*`), `auth.scope.denied`. En stdio la telemetría nunca va a stdout |
| web | `apps/web/src/lib/telemetry.ts` (singleton), `instrumentation.ts` | `http.request` (`observeRoute`), `auth.oauth.consent`, `error` (también `onRequestError`) |
| coordinación | `apps/server/src/http.ts` | `http.request`, `coordination.tool.call`, `auth.token.rejected`, `error` |

Las llamadas internas al broker usan `tracedFetch` (opción `fetch` de `createAgentClient`/`createOwnerClient`), así que una solicitud por el MCP deja en `ops.events` spans de `mcp` y `broker` con el mismo `trace_id` y `request_id` (prueba en `e2e/src/trace.test.ts`, que no requiere el stack).

## Visualizador del flujo (`packages/agent-flow`)

- Repetición pública en la landing (sección **En vivo**) y en `/embed/flujo` (iframe con `?autoplay&loop&speed&controls&panels&presence&owners`). Solo `/embed/*` envía `Content-Security-Policy: frame-ancestors *` (`apps/web/next.config.ts`).
- Modo en vivo en el admin, página **Flujo** (`/flujo`, rol viewer): `GET /api/admin/flow/snapshot` (foto de la red con cursor) y `GET /api/admin/flow/live` (SSE filtrado por nombre en SQL, attrs recortados con `projectFlowRow`, reanuda con `Last-Event-ID`). No hay endpoint público en vivo. Diseño, orden, huecos y regla de presencia: [docs/admin.md §7.1](docs/admin.md#71-flujo-en-vivo-flujo).
- Presencia: `broker.agent.connected` (se crea la conexión) y `broker.agent.revoked` (primera revocación) se registran dentro de la transacción del broker. La inactividad nunca saca a alguien de la red.
- Un evento nuevo del catálogo que deba verse en el grafo se agrega en `packages/agent-flow/src/telemetry.ts` (`flowEventNames`, `flowAttrKeys` y el mapeo) con su prueba: el servidor del admin filtra y recorta con esas mismas listas. Contrato de datos: [README del paquete](packages/agent-flow/README.md). Guía de presentación: [docs/agent-flow.md](docs/agent-flow.md).
- `pnpm --filter @team-31/agent-flow test|typecheck|build`. Sin variables de entorno nuevas.

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

**Agregar un escenario**: crea el JSON. **Agregar un invariante**: llama a `inv.check("nombre", ok, reqId, detalle)` en `apps/scale/src/run.mjs` (sobre respuestas) o agrega una consulta a `DB_CHECKS` en `apps/scale/src/invariants.mjs` (filas que violan; vacío = ok). Usa `inv.warn` sólo para desvíos conocidos del servidor que todavía no se arreglan.

## Comandos

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`. Antes de dar algo por listo: `pnpm lint && pnpm typecheck` (y `pnpm test` si aplica).

Para revisar la UI sin broker, Postgres ni login: `pnpm with-env env UI_FROZEN=1 TELEMETRY_SINK=off pnpm --filter @team-31/web dev`. Las páginas leen datos de ejemplo de `apps/web/src/lib/frozen.ts` y las acciones no guardan nada. Solo funciona fuera de producción.

### Hook pre-push (verificar solo lo afectado)

`pnpm install`/`pnpm bootstrap` activa los hooks de `.githooks/` (`git config core.hooksPath .githooks`, compartido por todos los worktrees; cada uno corre su propia versión). Antes de cada `git push`, `pre-push` ejecuta `scripts/check-affected.sh`:

- Calcula el merge-base con `origin/main` y corre `turbo run lint typecheck test --filter=...[<merge-base>]`: los paquetes cambiados (commits, staged, sin stage y archivos nuevos) **y los que dependen de ellos**, con la caché de turbo. Corre la suite completa de cada paquete afectado (no solo los tests "relacionados": migraciones, SQL y fixtures se leen en runtime y el grafo de imports no los ve).
- Si cambia configuración global (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `vitest.shared.ts`, `.nvmrc`, `.npmrc`, `scripts/with-env.sh`, `infra/postgres/`) o no existe `origin/main`, verifica todo. Si solo cambian docs o scripts fuera de los paquetes, no corre nada.
- Usa el `.env` del worktree (como `pnpm test`). Si Postgres no responde, lo dice y aborta: `pnpm infra:up`.
- Saltarlo: `git push --no-verify` o `SKIP_HOOKS=1 git push`. Otra base: `CHECK_BASE=<ref>`. Todo: `CHECK_ALL=1`.

Agentes: corre `pnpm check:affected` (lo mismo que el hook, sin pushear) antes de dar por lista una tarea; si `origin/main` está viejo, `git fetch origin` primero. No uses `--no-verify` para esconder un test roto: arréglalo o repórtalo.

`pnpm lint` solo cubre `apps/admin` y `apps/web`. El resto depende de `pnpm typecheck` y `pnpm test`, y `apps/demo` queda fuera de `typecheck`.

Las validaciones se ejecutan en el worktree local. El CI del repo del hackathon corre build y typecheck en cada push a `main`, sin disparar deploys.

### Tests rápidos (caché y código fuente)

- `pnpm test` cachea el resultado por paquete (turbo): si no cambió el paquete, sus dependencias del workspace ni `TEST_DATABASE_URL`/`DATABASE_URL`/`E2E_*`/`REDTEAM_*`, repite el log sin correr nada. Forzar: `pnpm test --force`. Un paquete: `pnpm test --filter @team-31/<pkg>`.
- Los tests no esperan el build: Vitest resuelve los paquetes del workspace a `src/` con la condición de export `"@team-31/source"` (config base en `vitest.shared.ts`). Solo `apps/server` (node --test sobre `dist/`) compila antes: córrelo con `pnpm test --filter @team-31/server`, no con `pnpm --filter … test`.
- Paquete nuevo con tests Vitest: agrega `vitest.config.ts` que extienda `vitest.shared.ts`; si exporta código, agrega `"@team-31/source": "./src/…"` junto a `types` en cada export. Si un test lee archivos de otro paquete que no es dependencia, decláralo en `inputs` de su `turbo.json` (ej. `apps/demo/turbo.json`).

### CI de tests (GitHub Actions)

- `.github/workflows/test.yml` corre `turbo run lint typecheck test` en cada PR y en cada push a `main`, con PostgreSQL 17 como servicio (`TEST_DATABASE_URL` fija en `127.0.0.1:5432/app_test`). Para reproducirlo: `pnpm lint && pnpm typecheck && pnpm test`.
- La caché local de turbo (`.turbo/cache`) persiste entre corridas con `actions/cache` (clave `turbo-test-<SO>-<hash del lockfile>-<run>`, restaura la más reciente por prefijo). Las corridas de `main` siembran la caché que leen los PR. `scripts/ci-turbo-prune.sh` deja solo las tareas de la última corrida, así no crece. `cd.yml` hace lo mismo con el prefijo `turbo-verify-`.
- Los paquetes corren en paralelo contra la misma `app_test`: un test con Postgres crea su base con `createTestDatabase` de `@team-31/test-db` (o un esquema con nombre único) y nunca depende de esquemas compartidos ni del orden de sus `it`.
- Si un test lee una variable de entorno nueva, agrégala al `env` de `test` en `turbo.json` o la caché repetirá resultados viejos. No uses puertos aleatorios en la URL de la base de CI: entran en el hash.

## ⚠️ Al agregar infra o configuración nueva

Si agregas un servicio (Redis, cola, etc.), una app que expone un puerto, o una variable de entorno, **en el mismo PR**:

1. Servicio en `docker-compose.yml` con puerto `${<SERVICIO>_PORT}` (nunca fijo).
2. Puerto `BASE + SLOT` en `scripts/env-init.sh` (bloque de puertos y `.env` generado). Elige una base que no choque.
3. Variables secretas en `.env.local.example`.
4. **Actualiza este AGENTS.md** (tabla de puertos, sección del servicio, comandos). Si no está aquí, el próximo agente no sabrá levantarlo.

Instrucciones específicas de cada app viven en `apps/<app>/AGENTS.md` o `README.md`.
