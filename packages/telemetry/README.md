# @team-31/telemetry

Telemetría de Nexo con catálogo tipado. Escribe en `ops.events` (esquema de `@team-31/ops`), que el admin lee con las vistas `ops.v_*`. Diseño: [docs/admin.md](../../docs/admin.md#3-telemetría-team-31telemetry-adm-01).

## Instrumentar un servicio en 5 líneas

```ts
import { createTelemetry, tracedFetch } from "@team-31/telemetry"
import { honoTelemetry } from "@team-31/telemetry/hono"

const telemetry = createTelemetry({ service: "broker", version: process.env.npm_package_version }) // sink según TELEMETRY_SINK; emite service.started y latido cada 30 s
app.use(honoTelemetry(telemetry))            // span http.request, lee traceparent, responde X-Trace-Id y X-Error-Id
const fetchInternal = tracedFetch(telemetry) // agrega traceparent a las llamadas internas
process.on("SIGTERM", () => void telemetry.shutdown())  // service.stopping + vacía la cola
```

Agrega `@team-31/telemetry: "workspace:*"` a las dependencias del servicio (y `hono` si usas el middleware).

## Uso

```ts
telemetry.emit("broker.request.created", { requestId, userId, attrs: { tool, rule } })

await telemetry.span("wake.attempt", { requestId }, async (span) => {
  const res = await deliver()
  span.set({ httpStatus: res.status, ok: res.ok })
})

try { … } catch (err) {
  const errorId = telemetry.error("POST /v1/agent/ask", err, { requestId })
  return c.json({ error: { code: "internal", errorId } }, 500, { "X-Error-Id": errorId })
}

telemetry.identify({ userId })                       // tras autenticar, dentro del request
await telemetry.context({ requestId }, () => job())  // fuera de HTTP (worker): inicia una traza
```

- `emit` nunca lanza. Los atributos no declarados en el catálogo se descartan. Si un atributo no pasa el esquema, el evento se guarda **sin attrs** y se emite `telemetry.invalid_event` (warn) con el nombre del evento y los códigos de issue.
- `span` registra duración, `status` (`ok` o `error`) y la jerarquía `trace_id`/`span_id`/`parent_span_id`. Si la función lanza, registra el error una vez y relanza; un `telemetry.error()` posterior con el mismo objeto devuelve el mismo `errorId`.
- `error()` devuelve un uuid para `X-Error-Id`. Nunca guarda el mensaje, la causa ni valores: solo `operation`, `type`, `issues` (códigos de zod), `code` (código de sistema o SQLSTATE) y `frames` del repo (`apps/…`, `packages/…`). Pasa como `operation` el patrón de ruta, no la ruta cruda.
- Contexto con `AsyncLocalStorage`; propagación con el encabezado W3C `traceparent`.

## Catálogo

Cada evento se declara una vez en [`src/catalog.ts`](src/catalog.ts) con `defineEvent({ name, kind, level, description, attrs })`. Solo escalares; prefiere enums y `code()` (sin espacios) antes que strings libres. Prohibido: tokens, encabezados `Authorization`, nonces, secretos de aviso, `args`, `result`, texto libre y URLs completas de aviso.

Se exportan `catalog`, `describeCatalog()` (JSON Schema de attrs para `admin://schema`) y los tipos `EventName` y `EventFields<N>`.

## Sinks

| Sink | Uso |
| --- | --- |
| `postgresSink(url \| opciones)` | Lotes de 200 o cada 500 ms, cola máxima 5000. Con la cola llena descarta y cuenta `dropped` (va en cada `service.heartbeat`). Si el INSERT falla, cuenta `failed` y escribe una línea en stderr sin el mensaje. |
| `consoleSink()` | Un JSON por línea en stdout. |
| `memorySink()` | Tests: `sink.records`, `sink.find(name)`. |

Sin `sink`, `createTelemetry` usa `sinkFromEnv()`: `TELEMETRY_SINK=postgres|console|off`. `postgres` usa `TELEMETRY_DATABASE_URL` o, si falta, `DATABASE_URL`; sin `TELEMETRY_SINK` elige `postgres` si hay URL y `console` si no. La tabla debe existir: `pnpm --filter @team-31/ops build && pnpm with-env pnpm --filter @team-31/ops migrate`.

## Tests

```bash
pnpm --filter @team-31/ops build
pnpm with-env pnpm --filter @team-31/telemetry test   # con TEST_DATABASE_URL corre también el sink de Postgres
```
