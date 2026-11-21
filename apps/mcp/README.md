# MCP de Sideband

## Grupos privados de la bóveda

- `sideband_contacts` lista los contactos aceptados. `sideband_contact_groups` lista tus grupos privados y sus miembros.
- `sideband_contact_group_change` permite `create`, `delete`, `add_contact` y `remove_contact`; todas las operaciones salvo `create` usan el ID del grupo. Puedes agregar solo contactos aceptados.
- `sideband_vault_members` lista los contactos con acceso efectivo a una categoría propia. Busca primero su ID con `sideband_vault_catalog`.
- Con `sideband_vault_change`, `set_contact_group` cambia el acceso de un grupo. `set_member` con `categoryId`, `address` y `allowed` agrega o quita un contacto aceptado de esa categoría. La decisión individual prevalece sobre grupos y etiquetas hasta que se cambie o se elimine el contacto.
- `sideband_network_users` (`sideband:ask`) lista direcciones con historial de conexión de agente, incluidas las que hoy no tienen agente activo. Devuelve hasta 50 por página; pasa `nextCursor` en `after` para continuar. Aparecer en el directorio no crea contactos ni permisos.
- Los grupos son privados, no son círculos ni etiquetas. Crear un grupo no comparte nada. Agregar un miembro le da acceso a lo ya compartido con el grupo. Quitar al contacto o eliminar el grupo revoca ese acceso, sin borrar datos ni tocar otros permisos. Administrar grupos requiere `sideband:vault`.

El servicio usa MCP Streamable HTTP en `MCP_RESOURCE_URL` y verifica el token OAuth en cada POST. Expone `sideband_ask`, `sideband_inbox`, `sideband_reply` y `sideband_check`. El evento `sideband.request.created` se suscribe por webhook y entrega solo el `requestId`. Tanto suscribirse como cancelar requieren `sideband:inbox`. Para cancelar, envía el nombre, los argumentos y la URL de entrega originales, o el `id` devuelto por la suscripción.

## Arranque local

Si un cliente envía `Origin` al endpoint `/mcp`, debe coincidir con el origen público de `MCP_RESOURCE_URL` (esquema, host y puerto). Los clientes nativos pueden omitirlo; la autenticación sigue siendo obligatoria.

Con `NODE_ENV=production`, `MCP_RESOURCE_URL`, `AUTH_ISSUER` y `AUTH_JWKS_URL` requieren HTTPS. El MCP valida las tres antes de abrir el puerto. Usa URLs sin credenciales, query ni fragmento.

1. Ejecuta `pnpm bootstrap` para generar `.env` con `MCP_PORT`, `MCP_RESOURCE_URL`, `AUTH_ISSUER` y `AUTH_JWKS_URL`. Si tu emisor o recurso público usa otro origen, configura esas URL en `.env.local`.
2. Configura `BROKER_URL` con la URL interna del broker y `MCP_SERVICE_PRIVATE_KEY` con su JWK privada Ed25519 en `.env.local`. La JWK pública correspondiente se registra como `mcp` en `SERVICE_JWT_PUBLIC_KEYS` del broker.
3. Ejecuta `pnpm build --filter @team-31/mcp^...` para compilar los paquetes compartidos y `pnpm dev --filter @team-31/mcp` para iniciar el servidor.

`GET /healthz` devuelve `{"ok":true}`. El descubrimiento OAuth está disponible en `/.well-known/oauth-protected-resource` y `/.well-known/oauth-protected-resource/mcp`. El servidor escucha en `127.0.0.1` por defecto. Puedes elegir otra interfaz con `MCP_HOST`.

Si prefieres Compose, usa `docker compose --env-file .env --env-file .env.local --profile sideband up -d --build mcp` con el puerto del host libre. Para ese comando, `AUTH_JWKS_URL` y `BROKER_URL` deben ser alcanzables desde el contenedor. Usa el nombre del servicio Compose o, para procesos en el host de Docker Desktop, `host.docker.internal` y el puerto de su worktree. Mantén `AUTH_ISSUER` y `MCP_RESOURCE_URL` con las URL públicas usadas por los clientes. Para detener solo el MCP en Docker, usa `docker compose --profile sideband stop mcp`.

## Modo de desarrollo

`MCP_DEV_AUTH=1` habilita `Authorization: Bearer dev:<userId>:<agentId>` con los cuatro scopes de Sideband. Para usar stdio en desarrollo, añade `SIDEBAND_DEV_USER_ID` y `SIDEBAND_DEV_AGENT_ID` a `.env.local`, compila con `pnpm build --filter @team-31/mcp` y ejecuta `pnpm with-env pnpm --filter @team-31/mcp start --stdio`. La conexión al broker conserva el JWT de servicio. `MCP_DEV_AUTH=1` aborta el arranque con `NODE_ENV=production`.

## Coordinar asistentes en local

### Probar dos identidades

Desde la raíz del repo, con Docker corriendo, usa Node 24 y pnpm 10. Si usas nvm, ejecuta `nvm use` y `corepack enable pnpm` una vez.

1. En una terminal, ejecuta `pnpm agents:up 2` y espera «Coordinación lista en puerto …». Déjala abierta.
2. En otra terminal, ejecuta `pnpm agents:demo 2`. El guion conecta clientes MCP por stdio y chequea las respuestas. Funciona sin cuenta de un proveedor de IA.
3. Para sumar a Carla con la API abierta, ejecuta `pnpm agents:seed 3` y luego `pnpm agents:demo 3`. El seed predeterminado crea 14 participantes y a Eva. Diego mantiene el identificador histórico `agente4`.

Puedes editar las personas, sus permisos iniciales y los bloques ocupados en [los datos de la demo](../../scripts/coordination-fixture.mjs).

El sábado ficticio es el **28 de noviembre de 2026**. Ana ve a Bob ocupado a las 16:00 y disponible a las 18:00 de Santiago. Eva, externa al grupo `futbol`, recibe `not_shareable`. El guion publica y retira un interés, revoca y restablece el permiso de Bob, y prueba las bandejas por persona. La última aceptación confirma el encuentro y muestra su ID. Cada corrida crea una propuesta nueva en PostgreSQL.

### Hablar con Ana y Bob en Claude Code

Con la API abierta, inicia estos comandos en **dos terminales distintas** desde la raíz. Cada sesión carga una sola identidad y usa las herramientas del MCP de coordinación. Claude Code requiere su propia sesión iniciada.

```sh
# Terminal de Ana
claude --strict-mcp-config --mcp-config .agents-local/ana.json --tools ""

# Terminal de Bob
claude --strict-mcp-config --mcp-config .agents-local/bob.json --tools ""
```

1. **Ana** — «Pregunta si Bob está libre el 28 de noviembre a las 18:00 de Santiago durante una hora en el grupo futbol».
2. **Bob** — «Desactiva mi permiso de compartir disponibilidad con el grupo futbol». Repite la consulta desde Ana para ver la denegación.
3. **Bob** — «Reactiva mi permiso». **Ana** — «Propón a Bob jugar el 28 de noviembre a las 16:00 o 18:00 de Santiago, por una hora, en futbol».
4. **Bob** — «Revisa mi bandeja y responde la propuesta usando mi agenda». **Ana y Bob**, cada uno en su sesión — «Acepto el horario propuesto». Consulta ese encuentro desde Ana para ver el estado `confirmed`.

La bandeja se consulta cuando activas la sesión. Los agentes comparten una API HTTP que verifica la credencial, y el broker comprueba membresía y permisos antes de leer disponibilidad y entregar el resultado. La decisión de asistir se registra por participante. Los archivos de configuración son privados del usuario local y dan acceso a la identidad que contienen.

### Consultar a un contacto

Ana envía su pregunta al servidor a través de MCP. El servicio verifica la identidad de Ana y consulta PostgreSQL. Bob puede estar desconectado. Para buscar una afición, Bob debe haberla publicado previamente. La audiencia se comprueba en cada lectura.

1. **Ana** — «Guarda a Bob en mis contactos y dime qué le puedo preguntar». `contact_connect` guarda la dirección sólo para Ana y devuelve las consultas permitidas, con su nombre y un JSON Schema de argumentos. `agent_capabilities` permite volver a consultar ese catálogo sin modificar los contactos.
2. **Bob** — «Publica mi interés en guitarra para el grupo futbol». Bob elige la audiencia. Si omite el grupo, todos los usuarios autenticados pueden encontrar la publicación.
3. **Ana** — «¿Quién de mis contactos tiene interés en guitarra?». `contact_interest_search` devuelve las coincidencias entre su lista personal y las publicaciones visibles para ella. `agent_interests` permite consultar los intereses visibles de una persona concreta.

El seed precarga las agendas de los perfiles de la demo. Guardar una dirección es unilateral. La disponibilidad sigue las reglas de la agenda y cada interés conserva su audiencia. Un catálogo vacío se devuelve tanto para una dirección desconocida como para una persona que no comparte información con el solicitante.

### Buscar entre los agentes de la agenda

La CLI y el dashboard de desarrollo usan el broker persistente del worktree. Después de `pnpm bootstrap`, inicia web y broker en el host. Web recibe los avisos firmados de los contactos aunque el navegador esté cerrado.

```sh
pnpm with-env env WAKE_ALLOW_INSECURE=1 pnpm exec turbo run dev --filter @team-31/broker-service --filter @team-31/web
```

En otra terminal, prepara las identidades y abre una sesión con Claude Code autenticado.

```sh
corepack pnpm agents:contacts:seed
corepack pnpm with-env corepack pnpm agents:runtime-demo "¿A alguien le interesa la cerámica?"
```

El seed crea 15 perfiles ficticios (14 participantes y Eva). Cada par dentro de un círculo arranca con ambas direcciones guardadas. Los círculos describen estos contactos iniciales. El grupo de disponibilidad `futbol` sigue siendo independiente.

| Círculo | Contactos entre sí |
|---|---|
| Taller | Ana, Bob, Inés y Luz |
| Huerto | Ana, Jane y Carla |
| Música | Carla, Diego, Mateo y Sofía |
| Montaña | Mateo, Leo, Tomás y Vera |
| Lectura | Vera, Alma, Nico y Eva |

Cada sesión carga de PostgreSQL los contactos directos de Ana con perfil de demo. Si Ana pregunta por «alguien», Claude descubre las direcciones y consulta el tema a **cada agente**. El broker evalúa sus reglas vigentes y entrega un resultado por ID. En las reglas iniciales, Luz reserva sus intereses y recibe cero avisos para esa operación. Cada contacto autorizado recibe un webhook y su propia sesión de Claude consulta el archivo privado.

Para cambiar un dato, edita la lista JSON `.agents-local/<id>-interests.json` de ese contacto y repite la pregunta. El seed conserva los archivos existentes y los contactos que alguien haya eliminado. Para una prueba temporal puedes pasar dos rutas tras la pregunta que sustituyen los archivos de Bob y Jane durante esa ejecución. Una lista vacía da `matches: false`; un archivo ausente da `no_data`. Sin pregunta se abre una sesión interactiva.

El MCP de Ana ofrece `list_contacts` para descubrir nombres y direcciones, `ask_contact` para consultar una dirección y `await_contact` para recoger el resultado por ID. Por ejemplo:

```json
{"contact":"demo-jane@sideband.app","query":{"interest":"cerámica"}}
```

Las preguntas abiertas usan `query: {"text":"…"}`. El broker verifica el permiso del destinatario para la operación. Cuando autoriza un interés, envía un webhook firmado al agente de ese contacto. Su herramienta `check_interest` compara el tema con su archivo y entrega sólo `matches`. El broker valida la respuesta y la CLI muestra la dirección y el resultado de cada solicitud.

Las identidades ficticias usan direcciones `demo-<id>@sideband.app`. La preparación inicial importa los lectores de cada perfil como grants de Sideband. Volver a ejecutar la seed conserva las decisiones posteriores del titular. PostgreSQL guarda reglas, solicitudes y avisos entre sesiones. En la demo, `await_contact` solo lee solicitudes creadas por `ask_contact` en la misma sesión MCP. Puedes correlacionar el ID de **Ver datos** con la actividad del broker.

### Herramientas

| Acción | Herramientas |
|---|---|
| Mis contactos y consultas permitidas | `list_contacts`, `contact_connect`, `contact_remove`, `agent_capabilities` |
| Intereses visibles por persona o entre mis contactos | `agent_interests`, `contact_interest_search` |
| Disponibilidad y relectura | `availability_check`, `request_get` |
| Permisos y membresía del titular | `group_permission`, `group_leave` |
| Publicación con audiencia | `interest_publish`, `interest_search`, `interest_withdraw` |
| Propuesta y bandeja | `meeting_propose`, `meeting_inbox`, `meeting_respond` |
| Estado y consentimiento | `meeting_get`, `meeting_decide` |

Puedes escribir los nombres de participantes como `Bob` o `bob`. Sólo se entrega la proyección de disponibilidad. La agenda ficticia y los hashes de las credenciales se guardan en la base del worktree. Volver a correr el seed conserva permisos revocados y salidas del grupo.

Los clientes generados por `agents:seed` usan el adaptador stdio `apps/server/dist/mcp.js` con su `AGENT_TOKEN` y `COORDINATION_API_URL`. El binario de `apps/mcp` sólo sirve Sideband.
