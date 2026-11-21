# @team-31/agent-flow

Visualizador en tiempo real de la conversación entre agentes a través del broker de Sideband. Lo usan tres lugares:

| Dónde | Modo | Fuente |
| --- | --- | --- |
| Landing (`apps/web`, sección «En vivo» de `/bienvenida`) | `replay` | `scenarioEvents()` (escenario ficticio) |
| `/embed/flujo` en `apps/web` (iframe para presentaciones) | `replay` + `fill` | `scenarioEvents()` |
| Admin, página **Flujo** (`/flujo`) | `live` | `/api/admin/live` (SSE de `ops.events`, sesión de admin) |

Sin dependencias: el grafo es SVG y HTML escritos a mano, las animaciones usan `requestAnimationFrame` y CSS. La única dependencia es `react` (peer).

## Uso

```tsx
import { AgentFlow } from "@team-31/agent-flow"
import { scenarioEvents } from "@team-31/agent-flow/scenario"

const events = useMemo(() => scenarioEvents(), [])
<AgentFlow mode="replay" events={events} />
```

| Prop | Por defecto | Qué hace |
| --- | --- | --- |
| `events` | — | `FlowEvent[]` en orden. En `live` la lista solo crece; si se acorta, el grafo se reinicia. |
| `mode` | — | `replay` (escenario completo, respeta los tiempos relativos) o `live` (aplica cada paso al llegar, escalonando ráfagas). |
| `loop` | `true` en replay | Vuelve a empezar 5 s después del último paso. |
| `autoPlay`, `speed` | `true`, `1` | Estado inicial de reproducción y velocidad (0.25–4). |
| `controls`, `panels` | `true`, `true` | Barra de controles y paneles de detalle y línea de tiempo. |
| `defaultOwners` | todos | Solo estos titulares: dirección, nombre o la parte antes de `@`, sin distinguir mayúsculas. |
| `fill` | `false` | Ocupa el alto del contenedor y escala desde un lienzo de 1440 × 810 (embed y proyector). |
| `presence` | `true` | Red completa: entradas, salidas y participantes pasivos. Con `false` solo aparecen quienes conversan. |
| `allowFullscreen` | `true` | Botón y tecla `f`. Usa la Fullscreen API; si no está disponible (iframe sin `allowfullscreen`), un modo expandido con CSS que se cierra con `Esc`. |
| `toolbar`, `emptyText`, `title` | — | Contenido extra en la barra, texto sin pasos y nombre accesible. |

Atajos con el foco dentro del visualizador (en `fill` o pantalla completa, en todo el documento): `f` pantalla completa, `p` pausa, `←`/`→` paso anterior y siguiente, `Esc` vuelve al presente o sale del modo expandido. Sin `controls` no hay inspección.

### Inspeccionar un paso

Un clic en la línea de tiempo (o `←`/`→`) pausa, reconstruye el estado justo antes de ese paso con `foldFlow` (fold puro de `reduceFlow`, con una foto cada 50 eventos para que buscar sea O(50)) y repite su animación: el pulso, la decisión en el broker, la entrega o la entrada y salida de la red. Luego se queda en el estado resultante. Los nodos que no participan se atenúan y la barra muestra «Viendo … · Continuar» («Volver al vivo» en vivo, con el número de eventos que llegaron mientras tanto). Las casillas salen de la historia completa, así que nada se reacomoda durante la repetición, y la línea de tiempo no cambia entre clics. «3 personas se unieron» repite la ola completa y «Repetir la solicitud», en el detalle, toda la cadena de una solicitud. Con movimiento reducido salta al estado final con un resaltado estático.

### Presencia en la red

- Pasivo: presente y sin conversaciones; se ve atenuado y sin arista. Al conversar por primera vez su arista se dibuja hacia el broker y la tarjeta se ilumina.
- Entrada: aparece desde fuera de su casilla con un leve rebote, dos ondas de acento, una línea de descubrimiento hacia el broker y el chip «Nuevo». Varias entradas seguidas se escalonan 150 ms y la línea de tiempo las agrupa.
- Salida: se apaga, se encoge, se aleja, su arista se retrae hacia el broker y queda un contorno punteado ~1,5 s.
- Contador «N en la red · M conversando» (titulares presentes y con algún paso en curso).
- Densidad: hasta 4 titulares en elipse, de 5 a 8 en dos filas con casillas fijas y desde 9 (7 en móvil) un avatar por titular en anillos o grilla, con etiquetas ocultas en reposo si hay más de 24.

Tema: todo color, sombra, fuente y curva sale de variables `--af-*` cuyos valores por defecto leen los tokens de `apps/web/src/app/globals.css` (`--color-card`, `--font-inter`, `--ease-smooth-out`…). Una app con otros tokens redefine los `--af-*` en un ancestro (ver `apps/admin/src/pages/flow.tsx`).

## Contrato de datos

### `FlowEvent` (`src/model.ts`)

Un paso del flujo entre dos extremos. Un extremo es `"broker"` o un `FlowActor`.

```ts
interface FlowEvent {
  id: string            // único y estable (id de ops.events, con sufijo :n si una fila produce varios pasos)
  at: number            // epoch ms; en spans es el inicio (at - durationMs)
  step: FlowStep        // ask | policy | request | wake | inbox | reply | sanitized | reply_blocked | escalated | owner_decided | delivered | check | tool
  status: FlowStatus    // pending | ok | allowed | denied | blocked | sanitized | escalated | delivered | expired | failed
  from: FlowEndpoint
  to: FlowEndpoint      // from === to === "broker" para pasos internos del broker (política, firma, saneo)
  requestId?: string
  traceId?: string
  meta: FlowMeta        // solo metadatos seguros (abajo)
}

interface FlowActor {
  id: string                   // "agent:<agentId>", "agent@<owner>" (provisional) u "owner@<owner>" (titular humano)
  role: "agent" | "owner"
  label: string                // etiqueta del agente ("Claude Code") o "Titular"
  owner: { key: string; label: string }  // key: dirección Sideband (o "user:<id>"); label: nombre visible
  channel?: string             // MCP, WhatsApp, OpenClaw…
  placeholder?: boolean        // agente aún no identificado; se fusiona con el primer agente real del titular
}
```

`FlowMeta` admite únicamente: `tool`, `category`, `decision`, `rule`, `outcome`, `fieldsDropped`, `flags`, `code`, `attempt`, `httpStatus`, `by`, `escalated`, `latencyMs`, `service`. Son códigos del catálogo de telemetría, nunca texto libre.

### Mapeo desde la telemetría (`src/telemetry.ts`)

`createTelemetryMapper(directory).map(row)` convierte una fila de `ops.events` (`TelemetryRow`, compatible con `TelemetryEvent` del admin) en 0..n pasos. Es el único lugar que conoce los nombres del catálogo y está probado en `src/telemetry.test.ts`.

| Evento del catálogo | Pasos |
| --- | --- |
| `broker.policy.evaluated` | `ask` (quien pregunta → broker, si aún no se dibujó) y `policy` (allow → `allowed`, deny → `denied`, ask_owner → `escalated`) |
| `broker.request.created` | `request` (broker). Guarda `targetAgentId`. |
| `mcp.tool.call`, `coordination.tool.call` (solo ask y check) | `sideband_ask`/`ask_contact` → `ask` (solo si la política aún no lo dibujó); `sideband_check` → `check`; `sideband_inbox` → `inbox`; `sideband_reply` → `reply` (si el broker aún no la registró); otras → `tool` |
| `wake.attempt`, `wake.exhausted` | `wake` broker → agente del destinatario (`ok`/`failed`, intento, HTTP) |
| `broker.request.status_changed` (by=agent, desde `awaiting_agent`) | `reply`; si pasa a `awaiting_owner`, además `escalated` broker → titular del destinatario |
| `broker.reply.rejected` | `reply_blocked` (`leak_blocked` → `blocked`, `expired` → `expired`, otro → `failed`), con `flags` |
| `broker.reply.sanitized` | `sanitized` (broker), con `flags` y `fieldsDropped` |
| `broker.owner.decided` | `owner_decided` titular → broker |
| `broker.request.closed` | `delivered` broker → quien preguntó (answered/no_data → `delivered`, declined/denied → `denied`, expired → `expired`, delivery_failed → `failed`) |
| cualquier otro (`http.request`, latidos, auth…) | nada. `flowEventNames` lista los que importan para filtrar antes de mapear. |

Campos de `ops.events` que usa: `id`, `at`, `service`, `name`, `requestId`, `userId`, `agentId`, `traceId`, `durationMs` y, de `attrs`, solo las claves de la tabla. Cualquier otra clave se ignora (hay una prueba con `args`, `result`, `text`, `nonce` y `token` que verifica que no aparezcan).

El `FlowDirectory` (`createFlowDirectory`) resuelve nombres. Todo es opcional; sin él se ven ids cortos:

- `users`: `userId`, `address`, `displayName` (admin: `/api/admin/users`).
- `agents`: `agentId`, `userId`, `label`, `kind` (WakeKind) (admin: `/api/admin/agents`).
- `requests`: `id`, `fromAddress`, `toAddress`, `targetAgentId`, `answeredByAgentId` (admin: `RequestSummary` de `/api/admin/requests/:id`). Sin el resumen, el destinatario se conoce recién con su primer `wake.attempt`.

### Presencia (`joined` / `left`)

Un `FlowEvent` con `step: "joined"` o `"left"` tiene `from === to === actor`. `reduceFlow` lo aplica de forma idempotente (una entrada repetida no cambia nada) y tolerante al orden (un evento con `at` más viejo que el último de presencia de ese actor se ignora). Participar en un paso posterior a una salida devuelve al actor a la red. `meta.snapshot` marca la foto inicial: se aplica de una vez, sin animación ni entrada en la línea de tiempo.

Señales reales que mapea hoy:

| Fuente | Paso |
| --- | --- |
| `mapper.snapshot(at)` sobre el directorio (`/api/admin/users` + `/api/admin/agents`) | `joined` (snapshot) por agente con `revokedAt` vacío y uno provisional («Sin agente») por titular con dirección y sin agentes |
| `whatsapp.link` (`confirmed` / `unlinked`, con `userId`) | `joined` / `left` del agente WhatsApp del titular |
| primer `mcp.tool.call` de un `agentId` que no estaba | `joined` y luego el paso de la tool |

Faltan señales explícitas para conectar y desconectar agentes por OAuth u otros canales. Propuesta para el PR del admin (no está en el catálogo): `broker.agent.connected` (`userId`, `agentId`, attrs `kind`) al verificar una conexión y `broker.agent.revoked` (`userId`, `agentId`, attrs `by: owner|admin`) al revocarla, emitidas desde `upsertAgentConnection` y `revokeAgent` del broker. Mientras tanto, la política recomendada es no inferir salidas por inactividad: un agente sin señales sigue «en la red» como pasivo, y sale solo con `unlinked`, una revocación o cuando un refresco de `/api/admin/agents` lo trae con `revokedAt` (el host emite entonces un `left`). Si se quiere atenuar la inactividad, que sea visual (pasivo tras 30 min sin pasos), no un `left`.

Qué se muestra: dirección Sideband y nombre del titular, etiqueta y canal del agente (lo mismo que ya ven los admins en Personas y Agentes). Nunca tokens, ids de cliente OAuth ni números de teléfono.

### Orden y duplicados

- El mapeo tiene estado por `requestId`: recuerda el agente de cada lado para atribuir eventos que no traen `agentId` (cierres, rechazos).
- Los spans (`mcp.tool.call`, `wake.attempt`) se escriben al terminar, así que llegan después de los eventos del broker que contienen. Por eso `ask` sale de `broker.policy.evaluated` y el span MCP solo dibuja la pregunta si llegó primero; lo mismo para `reply` entre `status_changed` y `sideband_reply`.
- Entrega las filas en orden de `id` de `ops.events` (el SSE del admin ya lo hace). El renderer aplica los pasos en el orden recibido y en vivo los separa al menos 320 ms para que cada pulso se vea; si se acumulan, acelera hasta alcanzarlos.

### Filtro por titular o agente

El filtro es de cliente: oculta tarjetas y pasos, no cambia la suscripción. Un paso se ve si sus dos extremos están visibles y, cuando tiene `requestId`, si todos los participantes conocidos de esa solicitud (quien pregunta, el agente destinatario y el titular) también lo están: «mostrar solo a Ana y Bob» oculta las solicitudes con Carla aunque Ana participe.

### Qué es seguro mostrar

Solo lo que ya está redactado en `ops.events` y en las lecturas del admin: códigos de tool, categoría, decisión, regla, resultado, campos descartados, códigos de saneo (`etapa:código`), intento y estado HTTP del aviso, latencia, ids de solicitud y traza, direcciones y nombres de titulares y etiquetas de agentes. Nunca tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result` ni texto libre de terceros. El escenario de la landing es ficticio.

## Modo en vivo: estado y pendientes

- `apps/admin/src/pages/flow.tsx` es un montaje mínimo: se suscribe a `/api/admin/live` sin filtros, descarta eventos fuera de `flowEventNames` y los anteriores a 30 s antes de abrir la página, pide el `RequestSummary` de cada solicitud nueva y espera hasta 2,5 s por él antes de mapear.
- Al cargar Personas y Agentes inserta la foto inicial de la red (`mapper.snapshot`) antes de cualquier evento en vivo.
- Pendiente: filtrar en el servidor por nombre de evento (hoy el SSE trae también `http.request` y latidos), reordenar por `at` dentro de una ventana corta si llegan eventos de varios servicios fuera de orden, y refrescar el directorio cuando aparece un usuario o agente nuevo después de abrir la página (hoy se cargan una vez, con `staleTime` de 60 s).
- El MCP stdio de `apps/demo` (Contactos de Ana) emite `coordination.tool.call` con `ask_contact` y `await_contact`, que el mapeo dibuja como `ask` y `check`; sus otras tools se ignoran. Con `DATABASE_URL` definido esa telemetría llega a `ops.events`.

## Desarrollo

```bash
pnpm --filter @team-31/agent-flow test      # mapeo, estado, layout y calendario
pnpm --filter @team-31/agent-flow typecheck
pnpm --filter @team-31/agent-flow build     # dist/ para web y admin
```
