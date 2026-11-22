# Agentes agnósticos de plataforma, probados entre dos máquinas

Fecha: 2026-11-21 · Estado: propuesto · Alcance: fase 1

## Intención

Hoy Sideband solo se ejercita en una máquina, con todo en loopback y con
Claude Code como único runtime de agente. Queremos verlo funcionando **como
si estuviera desplegado**: el stack detrás de un dominio https real, titulares
distintos en máquinas distintas, cada uno usando la herramienta de agente que
prefiera —claude-code, codex o pi— y preguntándose entre ellos en vivo.

El valor no es el túnel. Es descubrir qué se rompe cuando dejan de existir
`127.0.0.1`, `MCP_DEV_AUTH` y `WAKE_ALLOW_INSECURE`, y dejar demostrado que la
herramienta del titular es intercambiable sin tocar el servidor.

## Objetivos

- El stack corre en la máquina A detrás de un dominio https estable. OAuth real
  con Google, MCP remoto por Streamable HTTP, sin banderas de desarrollo.
- Cada titular es un contenedor con solo su CLI y el MCP de Sideband: un usuario
  desde cero. Levantar un titular más es levantar otro contenedor.
- Dos titulares con cuentas distintas se hacen solicitudes en ambos sentidos y
  ven la respuesta en segundos, corran en la misma máquina o en dos.
- Las tres herramientas —claude-code, codex, pi— **responden** una solicitud
  real, no solo la originan.
- Cambiar de herramienta no exige ningún cambio en broker, MCP ni web.
- El canal de sondeo es un canal de primera clase en el admin: una solicitud
  hacia un titular con CLI deja rastro, igual que una hacia Dot.
- El setup de un titular nuevo cabe en un comando y un consentimiento de navegador.

## No objetivos

- **La fase 2 (el demonio) queda fuera de este alcance.** Se documenta al final
  como dirección, no como entrega.
- Federación entre instancias. `ADDRESS_DOMAIN` es una constante única
  (`packages/protocol/src/address.ts:3`) y hay un solo broker
  (`apps/broker/src/compose.ts:33`). Dos máquinas significa un servidor y varios
  titulares, nunca dos Sidebands hablándose.
- Hilos de conversación. `AskInput` (`packages/protocol/src/request.ts:10`) no
  tiene `threadId` ni `replyTo`, y la invariante 5 exige un único estado final
  por solicitud. «Conversación» aquí es una secuencia de solicitudes
  independientes, cada una re-evaluando permisos.
- Lectura de calendario o de intereses desde una fuente real. En fase 1 el
  interés es la **comunicación general** entre agentes, no el acceso a datos.
- Despliegue de verdad. El túnel sustituye al dominio; no hay servidor remoto,
  ni TLS propio, ni CI de despliegue.
- Sustituir los avisos por webhook para los agentes alojados. Dot, Grok Bot y
  OpenClaw siguen con su `WakeTarget`; no se tocan.

## Anti-objetivos

Esto fracasa, aunque técnicamente funcione, si:

- Para probar una herramienta nueva hay que modificar el broker o el protocolo.
- Se agrega un quinto adaptador de aviso para hablarle a un CLI local por un
  túnel de vuelta: eso valida un camino que en producción no existe.
- El canal de sondeo queda invisible para el admin, como hoy.
- Se relaja una invariante de `docs/security.md` para que el escenario calce.

## Restricciones encontradas en el código

1. **Los cuatro adaptadores de aviso son POST salientes a una URL del agente**
   (`packages/wake/src/adapters/`), `mcpEventsPost` incluido. Todos asumen un
   servidor del otro lado.
2. **Un CLI local no es un servidor y no existe entre invocaciones.** Por eso el
   webhook no aplica a esta clase de cliente ni siquiera en producción, y el
   sondeo de la bandeja no es un parche: es la respuesta correcta.
3. **El canal de sondeo hoy es mudo, y nace mudo.** `broker.ts:228` crea toda
   conexión de agente nueva con `wakeTarget: { kind: "none" }`, y `worker.ts:19`
   descarta esas conexiones al elegir destinatario. Una solicitud hacia un
   titular con CLI no emite nada: se queda en `awaiting_agent` sin rastro hasta
   que la respondan o expire.
   Hay precedente para arreglarlo: en el lado del que pregunta, `worker.ts:56`
   ya registra el intento como `detail: "skipped"` cuando el canal de origen
   tiene `kind: "none"`, en vez de callarse.
4. **`.env.local` se carga después de `.env`** (`scripts/with-env.sh:12-17`), así
   que las URLs públicas se configuran sin tocar `scripts/env-init.sh`, que hoy
   fija `http://127.0.0.1` (líneas 46-62).
5. **Google es el único login** (`packages/auth/src/server.ts:28`). Un titular =
   una cuenta de Google = un consentimiento en navegador en su propia máquina.
6. **El registro dinámico de clientes OAuth está activo**
   (`allowDynamicClientRegistration`, `packages/auth/src/server.ts:63`), así que
   claude-code, codex y pi se registran solos. No hay configuración por cliente.
7. **El modo stdio del MCP exige `MCP_DEV_AUTH=1`** (`apps/mcp/src/sideband.ts:22`),
   de modo que el escenario sin banderas obliga al MCP remoto por HTTP, que es
   justo lo que queremos ejercitar.
7b. **La postura de producción ya está implementada** (`apps/mcp/src/oauth-config.ts`):
   con `NODE_ENV=production`, `MCP_RESOURCE_URL`, `AUTH_ISSUER` y `AUTH_JWKS_URL`
   exigen https, se validan antes de abrir el puerto, y se rechazan URLs con
   credenciales, query o fragmento. El túnel debe entregar https real y URLs
   limpias; no hay nada que descubrir aquí, hay que satisfacerlo.
7c. **Existe bóveda personal** (`packages/protocol/src/vault.ts`), expuesta por
   el MCP como `sideband_vault_catalog`, `sideband_vault_query` y
   `sideband_vault_change`: dato real del titular, guardado en el broker, con
   acceso por etiqueta de contacto. Cruza máquinas sin fixtures ni base local.
7d. **Las etiquetas de contacto traen sharing por defecto** (`constants.ts:24`)
   y **`general` solo viene en `family`**. `friend` da `availability` e
   `interests`; `work` solo `availability`.
8. **La bandeja entrega las solicitudes sin destinatario a todas las conexiones
   vivas del titular.** Dos agentes conectados compiten y el segundo recibe
   `conflict` (invariante 5).
9. **Las tres herramientas están instaladas en ambas máquinas.** Verificado:
   `codex-cli 0.162.1` en el Mac; en el t490 `claude`, `codex` y `pi` viven en
   `~/.nvm/versions/node/*/bin/` y **no están en el PATH de un `bash -lc` no
   interactivo** — hay que cargar nvm o usar rutas absolutas.
10. **El t490 tiene el repositorio en el mismo commit** (`00b1c14`), bajo
    `~/my-github/platanus-hack-26-cl-team-31`. Mismo path relativo a `$HOME`,
    no absoluto: `/home/aenrione` contra `/Users/alfredoenrione`.
11. **Lo que está clavado a Claude es el harness del demo**, no el producto:
    `apps/demo/src/contact-session.mjs:33,82,89`, `contact-runtime.mjs:19` y
    `claudeEnv()` en `contact-broker.mjs:101`, que solo deja pasar `ANTHROPIC_*`.

## Enfoques considerados

**A. Demonio local con adaptadores de CLI.** Un proceso por titular que se
autentica contra el broker, sondea su bandeja y, por cada solicitud, lanza un
turno headless del CLI configurado. El bucle de respuesta ya existe:
`createOwnerRuntime` + `localReadTool` de `@team-31/broker/client`. Lo nuevo es
el sondeo, el refresco del token OAuth y un adaptador por plataforma.

**B. Sin demonio: el CLI se sondea a sí mismo.** Cada titular deja su CLI
abierto contra el MCP remoto por OAuth, con una instrucción de revisar
`sideband_inbox` en bucle; el iterador de `docs/poc/sideband-watch.mjs` ya hace
eso. Cero código de runtime nuevo.

**C. Demonio sin LLM**, respondiendo directo con `localReadTool`. Descartado:
es trivial y no demuestra lo pedido, que las tres herramientas respondan.

**Decisión: se construye B.** Desarma el riesgo que no es código —dominio
estable, consentimiento real, tres clientes distintos contra el mismo MCP— y
deja el escenario montado y reproducible. A queda documentada como dirección y
se decide después, a la luz de lo que B enseñe.

## Lo decidido

### Topología

La máquina A (macOS) hospeda postgres, broker, MCP y web, y expone **solo web y
MCP** por un túnel con dominio estable. El t490 no hospeda nada y nunca necesita
ser alcanzable desde afuera: todas sus conexiones son salientes. El broker sigue
en loopback.

El dominio debe ser estable entre reinicios, porque la URL queda escrita en
`BETTER_AUTH_URL`, `MCP_RESOURCE_URL`, `AUTH_ISSUER` y `AUTH_JWKS_URL`. Un túnel
efímero rompe el login en cada sesión.

**El túnel es Tailscale Serve**, no un túnel público. Da un nombre MagicDNS
estable (`<máquina>.tail88af94.ts.net`) con certificado real de Let's Encrypt, y
**no expone nada a internet**: solo alcanzable dentro del tailnet. Mejor postura
que ngrok o cloudflared y sin cuenta nueva. HTTPS quedó habilitado en el tailnet
el 2026-11-21.

`ssh -L` se descartó: da `localhost:PUERTO` en texto plano, y
`apps/mcp/src/oauth-config.ts` exige https en las tres URLs con
`NODE_ENV=production`. Obligaría a correr en modo desarrollo, que es la bandera
que esta fase existe para quitar.

El contenedor debe resolver **ese mismo nombre**, no una IP: OAuth compara el
issuer exacto. Se resuelve con `--add-host <nombre>:<IP de tailscale>` al
levantarlo.

### Qué se prueba: comunicación general

El escenario ejercita la categoría **`general`** con la tool `question`: un
titular le pregunta algo en texto libre al agente de otro, y ese agente responde.
No se instalan fixtures, ni se lee calendario, ni intereses.

Dos fuentes de respuesta, en este orden:

1. **Texto libre.** El agente responde desde su propio contexto. El t490 tiene
   el repositorio en el mismo commit, así que hay de qué hablar.
2. **Bóveda.** El titular del t490 carga dos o tres entradas con
   `sideband_vault_change` y una de las preguntas se responde con dato real,
   leído por `sideband_vault_query` sobre el mismo MCP remoto. Esto ejercita el
   filtrado por categoría, que es la mitad de las invariantes, sin mover datos
   entre máquinas.

Para que `general` esté permitido, los dos titulares se etiquetan **`family`**
(`friend` no incluye `general`), o se da el grant explícito.

Esto mantiene la prueba sobre el camino que importa —permiso, aviso, bandeja,
respuesta firmada, filtrado de campos— sin arrastrar datos de demo entre
máquinas. Calendario e intereses quedan para después.

### Identidades: login de desarrollo, no Google

El proveedor de identidad es ortogonal a lo que esta fase prueba. Que el humano
demuestre quién es con Google o con una contraseña no cambia nada del camino que
nos interesa: el CLI sigue obteniendo un access token OAuth real de Better Auth,
con registro dinámico de cliente y verificación por JWKS.

Por eso se agrega `SIDEBAND_DEV_AUTH=1` en web, con la misma forma que las tres
guardas que ya existen en el repo —`MCP_DEV_AUTH`, `WAKE_ALLOW_INSECURE`,
`ADMIN_DEV_AUTH`— que se rechazan al parsear el entorno si `NODE_ENV=production`.
El precedente exacto es `apps/admin/server/api.ts:348` con `ADMIN_DEV_AUTH`.

**Lo que esto compra:** desaparece el techo de dos cuentas de Google. Se pueden
levantar tres titulares simultáneos, uno por CLI, en vez de rotar. Y desaparece
el riesgo de que Google rechace un redirect en un dominio que no es tuyo, porque
el escenario no pasa por Google.

**Lo que sigue siendo real, y es lo que la fase prueba:** origen https con
certificado válido, MCP remoto por Streamable HTTP, flujo de código de
autorización con registro dinámico, verificación de tokens por JWKS, la pantalla
de consentimiento, y todo el camino de permiso, bandeja, nonce y respuesta
firmada.

**Lo único que se vuelve de desarrollo** es cómo el humano se autentica en la
pantalla de login. El consentimiento no se salta: es parte del flujo.

Google sigue configurado y funcionando para el uso normal; `SIDEBAND_DEV_AUTH`
no lo reemplaza, lo acompaña.

**Antes de rotar se revoca la conexión anterior** (decisión mía): la bandeja
entrega las solicitudes sin destinatario a todas las conexiones vivas del
titular, y dos agentes contestando producen un `conflict`. Lo mismo aplica si
ese titular tiene además un receptor del demo conectado.

### Tiempo real

«Tiempo real» significa latencia, no hilo ni socket: la respuesta aparece lo
antes posible mediante sondeo de la bandeja. Los agentes alojados tampoco
mantienen sockets. El criterio es que una solicitud permitida se vea respondida
en segundos, y que varias seguidas en ambos sentidos se sientan como una
conversación.

### Observabilidad: el sondeo como canal normal

El canal de sondeo deja de ser mudo. Hoy un titular con CLI tiene
`wakeTarget: { kind: "none" }` y el worker lo salta sin emitir nada, de modo que
el admin no distingue «nadie conectado» de «conectado por sondeo».

La forma propuesta es un `WakeKind` nuevo —`"polling"`— que el worker reconoce
sin hacer ningún POST, pero que **sí registra** el despacho, y que
`views.ts:103` ya expone como `wakeKind` hacia el admin. Así una solicitud hacia
un CLI aparece en `ops.events` y en el panel con su canal, su `requestId` y su
latencia hasta la respuesta, igual que una hacia Dot.

Esto es la única parte de fase 1 que toca código del servidor, y es trabajo de
protocolo y broker, no del cliente. Va con su entrada en el catálogo de
telemetría y su línea «Cómo se ve en el admin» en el PR.

### Instrucciones por plataforma

El bloque de confianza de `docs/agents/trust-snippet.md` se empaqueta en la
forma nativa de cada herramienta: skill o archivo de contexto para claude-code,
archivo de contexto para codex, instrucciones de sistema para pi. El contenido
es el mismo; cambia el envase. Ahí vive también la instrucción de sondear la
bandeja.

### Un contenedor por titular

Cada titular es un contenedor que contiene **solo** su CLI y el MCP de Sideband
configurado: un usuario desde cero, sin repositorio, sin base, sin estado
heredado. Esa es la unidad reproducible y la que hace la prueba escalable —
levantar un titular más es levantar otro contenedor.

Como el titular es un contenedor y no una máquina, **el t490 deja de ser un
requisito**. El mismo contenedor corre tres veces en el Mac o una vez allá; «otra
máquina» pasa a ser una variable de despliegue, no una precondición. De paso
muere el problema del Node 18.

La base es `~/my-github/os/ai-containers` (Debian trixie, `codex` binario,
`claude-code` por npm, cortafuegos de egreso por lista de dominios,
`mcpServers: {}` vacío). Se deriva una imagen delgada encima. Tres cosas hay que
resolver sobre esa base:

- **Arquitectura.** El `Containerfile` fija aarch64 (tarball de codex y Go
  arm64). Hay que parametrizarlo o no construye en x86_64.
- **`pi` no está** en la imagen.
- **El cortafuegos de egreso bloquea Sideband.** `allowed-domains.txt` no
  incluye el dominio del túnel, `accounts.google.com` ni el endpoint de Ollama.
  Hay que abrirlos **explícitamente y nada más**: el efecto secundario es que el
  escenario demuestra que el agente solo habla con Sideband y su modelo. Esa
  propiedad se conserva.

### El consentimiento OAuth sale de la caja

Es el único paso del flujo que no queda dentro del contenedor: `mcp login` abre
un navegador y escucha en un puerto local. Hay que publicar ese puerto y abrir
la URL en el navegador del anfitrión. Se documenta como paso manual; no se
automatiza.

### Credenciales de modelo

Las cuentas de Google son para Sideband. El modelo es aparte, y cada contenedor
lleva la suya:

| CLI | Proveedor | Por qué |
| --- | --- | --- |
| claude-code | Anthropic, `claude-haiku-4-5` | nativo |
| pi | Anthropic, `claude-haiku-4-5` | elige proveedor por bandera |
| codex | Ollama | codex solo habla OpenAI-compatible; Ollama expone ese dialecto |

`claude-haiku-4-5` es el modelo Anthropic más barato ($1/$5 por millón de tokens
de entrada/salida) y sobra para leer un ítem de bandeja y llamar una tool. Esta
combinación evita necesitar una llave de OpenAI.

El endpoint es Ollama Cloud (`https://ollama.com/v1`), que sirve modelos de
clase frontera, no modelos chicos locales. **Medido el 2026-11-21** contra una
definición de tool con la forma de `sideband_reply`:

| Modelo | Resultado |
| --- | --- |
| `gpt-oss:120b` | llama la tool y preserva el `nonce` exacto |
| `kimi-k3` | llama la tool y preserva el `nonce` exacto |
| `glm-5.3` | no emite tool call |

Se elige **`gpt-oss:120b`** para codex: es el modelo abierto de OpenAI y es el
que mejor calza con el formato de tools que codex espera.

**Confusor, ahora acotado:** la hipótesis inicial era que un modelo de Ollama
fallaría llamando tools y que ese fallo se leería como un defecto del broker.
La medición lo desmiente para el modelo elegido, así que el riesgo baja de
probable a residual. Igual el guion registra *por qué* falló un turno: la
distinción entre fallo de modelo y fallo de Sideband sigue siendo necesaria, y
`glm-5.3` muestra que la capacidad no es uniforme entre modelos.

### Tamaño de los PR

La regla de ~500 líneas del repositorio no aplica a este trabajo.

## Dirección: la fase 2, si se construye

Un paquete con el bucle (autenticación, sondeo, despacho, respuesta) y un
adaptador por plataforma: un objeto pequeño con `{ bin, args({ systemPrompt,
mcpConfig, allowedTools, prompt }), parse }`. `contact-runtime.mjs:19` pasaría a
ser el primer adaptador, de forma **aditiva**: Contactos de Ana sigue
funcionando igual (decisión mía).

El demonio se autenticaría por **OAuth, y ninguna llave de servicio sale de la
máquina A** (decisión mía). Eso implica un `AgentPort` delgado sobre
`sideband_inbox` y `sideband_reply` en vez de `createOwnerClient` contra
`/v1/agent/*`, que exigiría copiar un `*_SERVICE_PRIVATE_KEY` al t490 y darle a
esa máquina el derecho de acuñar cualquier principal.

Queda abierto cómo refresca el token (el access token dura 3600 s,
`packages/auth/src/server.ts:70`).

## Lo que queda al constructor

- Qué servicio de túnel y cómo se obtiene el dominio estable.
- La forma exacta de la configuración de MCP remoto en codex y pi, a confirmar
  contra sus CLIs antes de escribir la guía.
- Si la fase 1 deja un script de verificación o solo un documento.
- El nombre del `WakeKind` de sondeo y qué evento del catálogo emite el worker.
