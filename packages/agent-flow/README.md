# @team-31/agent-flow

Visualizador en tiempo real de la conversación entre agentes a través del broker de Sideband. Lo usan tres lugares:

| Dónde | Modo | Fuente |
| --- | --- | --- |
| Landing (`apps/web`, sección «En vivo» de `/bienvenida`) | `replay` | `scenarioEvents()` (escenario ficticio) |
| `/embed/flujo` en `apps/web` (iframe para presentaciones) | `replay` + `fill` | `scenarioEvents()` |
| Admin, página **Flujo** (`/flujo`) | `live` | `/api/admin/flow/snapshot` + `/api/admin/flow/live` (SSE filtrado de `ops.events`, sesión de admin) |

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
| `defaultHiddenActors`, `onFilterChange` | — | Agentes ocultos al inicio y aviso de cada cambio del filtro (`{ owners, hiddenActors }`) para guardarlo en la URL. |
| `eventActions` | — | Contenido extra en el detalle de un paso (el admin pone enlaces a la solicitud y la traza). |

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
  channel?: string             // MCP, OpenClaw…
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
| `broker.agent.connected` / `broker.agent.revoked` | `joined` / `left` del agente (`meta.by` = `owner` o `admin` al revocar) |
| cualquier otro (`http.request`, latidos, auth…) | nada. `flowEventNames` lista los que importan para filtrar antes de mapear. |

Campos de `ops.events` que usa: `id`, `at`, `service`, `name`, `requestId`, `userId`, `agentId`, `traceId`, `durationMs` y, de `attrs`, solo las claves de `flowAttrKeys`. El servidor del admin recorta cada fila a esa lista con `projectFlowRow` y descarta con `isFlowRow` lo que no dibuja nada, así que lo demás ni siquiera llega al navegador (pruebas con `args`, `result`, `text`, `nonce` y `token` en el mapeo y en `apps/admin/server/api.test.ts`).

Nombres: `ownerLabel` usa el nombre del titular o, si no tiene, la parte local de la dirección sin prefijos de prueba (`demo-ana@…` → «Ana»). La clave sigue siendo la dirección.

El `FlowDirectory` (`createFlowDirectory`) resuelve nombres. Todo es opcional; sin él se ven ids cortos:

- `users`: `userId`, `address`, `displayName` (admin: `/api/admin/users`).
- `agents`: `agentId`, `userId`, `label`, `kind` (WakeKind) (admin: `/api/admin/agents`).
- `requests`: `id`, `fromAddress`, `toAddress`, `targetAgentId`, `answeredByAgentId` (admin: `RequestSummary` de `/api/admin/requests/:id`). Sin el resumen, el destinatario se conoce recién con su primer `wake.attempt`.

### Presencia (`joined` / `left`)

Un `FlowEvent` con `step: "joined"` o `"left"` tiene `from === to === actor`. `reduceFlow` lo aplica de forma idempotente (una entrada repetida no cambia nada) y tolerante al orden (un evento con `at` más viejo que el último de presencia de ese actor se ignora). Participar en un paso posterior a una salida devuelve al actor a la red. `meta.snapshot` marca la foto inicial: se aplica de una vez, sin animación ni entrada en la línea de tiempo.

Señales:

| Fuente | Paso |
| --- | --- |
| `mapper.snapshot(at)` sobre la foto (`/api/admin/flow/snapshot`) | `joined` (snapshot) por agente con `revokedAt` vacío y uno provisional («Agente») por titular con dirección y sin agentes |
| `broker.agent.connected` (al crearse la conexión: primera llamada autenticada del agente) | `joined` |
| `broker.agent.revoked` (titular o admin, solo la primera vez) | `left` |
| primer paso de un agente que no estaba (p. ej. `mcp.tool.call`) | `joined` y luego el paso |
| `mapper.reconcile(at)` tras refrescar el directorio | `left` por cada presente que ahora figura revocado y `joined` por cada agente nuevo (cubre señales perdidas mientras el stream estuvo caído) |

**Regla de salida.** Un agente está en la red mientras su conexión no esté revocada (un titular con dirección que nunca conectó un agente aparece en la foto como agente provisional; uno cuyos agentes se revocaron, no). Sale solo con una revocación, un `unlinked` o un refresco que lo trae revocado. La inactividad no es una salida: un agente sin pasos se ve como pasivo. `mapper.takeUnknown()` devuelve los usuarios y agentes que aparecieron sin estar en el directorio para que el host lo refresque.

Qué se muestra: dirección Sideband y nombre del titular, etiqueta y canal del agente (lo mismo que ya ven los admins en Personas y Agentes). Nunca tokens, ids de cliente OAuth ni números de teléfono.

### Orden y duplicados

- `createLiveFeed(mapper)` (`src/live.ts`) es la entrada del modo en vivo: descarta ids repetidos (reconexiones y relecturas del servidor) y retiene cada fila hasta 700 ms para ordenarlas por el momento en que ocurrieron (inicio para spans) y luego por id. Un span del MCP que se escribió después que los eventos del broker que contiene se aplica en su lugar. El reloj de cada servicio solo influye dentro de esa ventana: un servicio desfasado no retiene a los demás.
- El mapeo también descarta una fila repetida y tiene estado por `requestId`: recuerda el agente de cada lado para atribuir eventos que no traen `agentId` (cierres, rechazos). Con el resumen de la solicitud (`event: request` del stream) el destinatario se conoce desde el primer evento.
- Si aun así un span llega tarde, `ask` sale de `broker.policy.evaluated` y el span MCP solo dibuja la pregunta si llegó primero; lo mismo para `reply` entre `status_changed` y `sideband_reply`.
- En vivo el renderer separa los pasos al menos 320 ms para que cada pulso se vea; si se acumulan, acelera hasta alcanzarlos.
- Ventana: el host puede quitar los pasos más viejos de `events` (conservando el resto en orden). El renderer recorta su calendario y guarda el estado previo como base de `foldFlow`, así que la presencia y las solicitudes en curso no se pierden ni se reinicia el grafo.

### Filtro por titular o agente

El filtro es de cliente: oculta tarjetas y pasos, no cambia la suscripción. Un paso se ve si sus dos extremos están visibles y, cuando tiene `requestId`, si todos los participantes conocidos de esa solicitud (quien pregunta, el agente destinatario y el titular) también lo están: «mostrar solo a Ana y Bob» oculta las solicitudes con Carla aunque Ana participe.

### Qué es seguro mostrar

Solo lo que ya está redactado en `ops.events` y en las lecturas del admin: códigos de tool, categoría, decisión, regla, resultado, campos descartados, códigos de saneo (`etapa:código`), intento y estado HTTP del aviso, latencia, ids de solicitud y traza, direcciones y nombres de titulares y etiquetas de agentes. Nunca tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result` ni texto libre de terceros. El escenario de la landing es ficticio.

## Modo en vivo en el admin

Diseño completo en [docs/admin.md §7.1](../../docs/admin.md#71-flujo-en-vivo-flujo). Resumen:

- `apps/admin/src/lib/flow-live.ts`: foto → stream desde su cursor → `createLiveFeed` → `FlowEvent[]` (como mucho 4.000; luego descarta los más viejos). Reconecta con `Last-Event-ID`; tras un corte largo o un `reset` toma otra foto y reconcilia.
- Servidor (`apps/admin/server/live.ts`): filtro por nombre en SQL, recorte de `attrs`, resumen de cada solicitud, relectura de 3 s para escrituras que confirman tarde, `reset` con huecos grandes y telemetría `admin.live.*`.
- El MCP stdio de `apps/demo` (Contactos de Ana) emite `coordination.tool.call` con `ask_contact` y `await_contact`, que el mapeo dibuja como `ask` y `check`; sus otras tools se ignoran (y el servidor no las envía).

## Desarrollo

```bash
pnpm --filter @team-31/agent-flow test      # mapeo, estado, layout y calendario
pnpm --filter @team-31/agent-flow typecheck
pnpm --filter @team-31/agent-flow build     # dist/ para web y admin
```
