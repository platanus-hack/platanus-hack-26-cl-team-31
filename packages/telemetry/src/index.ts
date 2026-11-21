// @team-31/telemetry: telemetría de Sideband con catálogo tipado (docs/admin.md#3).
// El middleware de Hono vive en "@team-31/telemetry/hono" para que los servicios sin Hono
// no necesiten la dependencia.
export {
  catalog,
  defineEvent,
  describeCatalog,
  getEventDefinition,
  type Catalog,
  type CatalogEntry,
  type CatalogEvent,
  type EventAttrs,
  type EventDef,
  type EventDefinition,
  type EventFields,
  type EventName,
} from "./catalog.js";
export { formatTraceparent, parseTraceparent, type ContextFields, type TelemetryContext } from "./context.js";
export { tracedFetch } from "./fetch.js";
export { summarizeError, type ErrorSummary } from "./redact.js";
export { consoleSink, offSink, type ConsoleSinkOptions } from "./sinks/console.js";
export { sinkFromEnv } from "./sinks/env.js";
export { memorySink, type MemorySink } from "./sinks/memory.js";
export { postgresSink, type PostgresSinkOptions, type Queryable } from "./sinks/postgres.js";
export {
  createTelemetry,
  silentTelemetry,
  type SpanFields,
  type SpanHandle,
  type Telemetry,
  type TelemetryOptions,
} from "./telemetry.js";
export {
  EventKind,
  Level,
  Service,
  type Scalar,
  type SinkStats,
  type TelemetryRecord,
  type TelemetrySink,
} from "./types.js";
