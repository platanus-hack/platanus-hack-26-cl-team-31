import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { type CatalogEvent, type EventAttrs, type EventFields, type EventName, getEventDefinition } from "./catalog.js";
import {
  type ContextFields,
  formatTraceparent,
  newSpanId,
  newTraceId,
  parseTraceparent,
  storage,
  type TelemetryContext,
} from "./context.js";
import { summarizeError } from "./redact.js";
import { sinkFromEnv } from "./sinks/env.js";
import { Level, type Scalar, Service, type SinkStats, type TelemetryRecord, type TelemetrySink } from "./types.js";

const HEARTBEAT_MS = 30_000;
const MAX_ATTRS_BYTES = 8000; // ops.events.attrs tiene CHECK pg_column_size <= 8192.

export interface TelemetryOptions {
  service: Service;
  version?: string;
  /** Por defecto sinkFromEnv() (TELEMETRY_SINK). */
  sink?: TelemetrySink;
  /** Por defecto hostname:pid. */
  instance?: string;
  /** Intervalo del latido service.heartbeat. 0 lo desactiva. Por defecto 30 s. */
  heartbeatMs?: number;
  /** Emite service.started, service.heartbeat y service.stopping. Por defecto true. */
  lifecycle?: boolean;
}

export interface SpanFields<N extends EventName> extends ContextFields {
  attrs?: EventAttrs<N>;
  /** Encabezado traceparent entrante: el span continúa esa traza como hijo remoto. */
  traceparent?: string | null;
}

export interface SpanHandle<N extends EventName> {
  readonly traceId: string;
  readonly spanId: string;
  /** Agrega atributos del catálogo al span (se validan al cerrar). */
  set(attrs: EventAttrs<N>): void;
  /** Por defecto "ok", o "error" si la función lanza. */
  setStatus(status: string): void;
  setLevel(level: Level): void;
  /** Asocia el span a un error ya registrado con telemetry.error(). */
  setErrorId(errorId: string): void;
}

export interface Telemetry {
  readonly service: Service;
  readonly instance: string;
  readonly version: string;
  /** Registra un evento del catálogo. Nunca lanza; los attrs no declarados se descartan. */
  emit<N extends EventName>(name: N, fields?: EventFields<N>): void;
  /** Ejecuta fn dentro de un span y registra su duración. Si fn lanza, registra el error y relanza. */
  span<N extends EventName, T>(name: N, fields: SpanFields<N>, fn: (span: SpanHandle<N>) => T | Promise<T>): Promise<T>;
  /** Registra un error sin mensajes crudos y devuelve su errorId (para X-Error-Id). */
  error(operation: string, error: unknown, fields?: ContextFields): string;
  /** Contexto activo, o undefined fuera de un request/span. */
  context(): Readonly<TelemetryContext> | undefined;
  /** Ejecuta fn con ids de correlación agregados al contexto (inicia traza si no hay). */
  context<T>(fields: ContextFields, fn: () => T): T;
  /**
   * Agrega ids al contexto activo en el lugar (p. ej. userId tras autenticar dentro de
   * http.request): los ven los eventos siguientes y el span que lo contiene. Fuera de un
   * contexto no hace nada.
   */
  identify(fields: ContextFields): void;
  /** Encabezado traceparent para una llamada saliente, o undefined fuera de una traza. */
  traceparent(): string | undefined;
  stats(): SinkStats;
  flush(): Promise<void>;
  /** Detiene el latido, emite service.stopping, vacía la cola y cierra el sink. Idempotente. */
  shutdown(): Promise<void>;
}

// Campos de emit() sin el tipado por evento (la validación real la hace el catálogo).
type LooseFields = Omit<EventFields, "attrs"> & { attrs?: unknown };

function sanitizeName(name: unknown): string {
  return String(name).slice(0, 128).replace(/[^\w.:/@*-]/g, "_") || "unknown";
}

function definedFields(fields: ContextFields): ContextFields {
  const out: ContextFields = {};
  if (fields.requestId !== undefined) out.requestId = fields.requestId;
  if (fields.userId !== undefined) out.userId = fields.userId;
  if (fields.agentId !== undefined) out.agentId = fields.agentId;
  return out;
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const service = Service.parse(options.service);
  const version = options.version ?? "dev";
  const instance = options.instance ?? `${hostname()}:${process.pid}`;
  const sink = options.sink ?? sinkFromEnv();
  const lifecycle = options.lifecycle ?? true;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  // Reutiliza el errorId si un span y su manejador reportan el mismo error en esta instancia.
  const reported = new WeakMap<object, string>();
  let closed = false;

  interface RecordExtra {
    traceId?: string | null;
    spanId?: string | null;
    parentSpanId?: string | null;
    errorId?: string | null;
    level?: Level;
    status?: string | null;
    durationMs?: number | null;
    context?: TelemetryContext;
  }

  function invalid(name: string, issues: string) {
    if (name === "telemetry.invalid_event") return; // sin recursión
    record("telemetry.invalid_event", { attrs: { event: sanitizeName(name), issues: issues.slice(0, 512) } }, {});
  }

  function validateAttrs(definition: CatalogEvent, attrs: unknown): Record<string, Scalar> {
    const parsed = definition.attrs.safeParse(attrs ?? {});
    if (!parsed.success) {
      invalid(definition.name, parsed.error.issues.map((issue) => `${issue.code}:${issue.path.join(".")}`).join(","));
      return {};
    }
    const clean: Record<string, Scalar> = {};
    for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
      if (value !== undefined) clean[key] = value as Scalar;
    }
    if (Buffer.byteLength(JSON.stringify(clean)) > MAX_ATTRS_BYTES) {
      invalid(definition.name, "too_big:attrs");
      return {};
    }
    return clean;
  }

  function record(name: string, fields: LooseFields, extra: RecordExtra) {
    if (closed) return;
    try {
      const definition = getEventDefinition(name);
      if (!definition) {
        invalid(name, "unknown_event");
        return;
      }
      const attrs = validateAttrs(definition, fields.attrs);
      const ctx = extra.context ?? storage.getStore();
      const pick = (key: keyof ContextFields) => {
        const value = fields[key];
        return value !== undefined ? value : (ctx?.[key] ?? null);
      };
      const row: TelemetryRecord = {
        at: new Date(),
        service,
        instance,
        kind: definition.kind,
        name,
        // Un nivel fuera del CHECK haría fallar el lote entero en Postgres.
        level: Level.safeParse(extra.level ?? fields.level).data ?? definition.level,
        traceId: extra.traceId !== undefined ? extra.traceId : (ctx?.traceId ?? null),
        spanId: extra.spanId ?? null,
        parentSpanId: extra.parentSpanId !== undefined ? extra.parentSpanId : (ctx?.spanId ?? null),
        requestId: pick("requestId"),
        userId: pick("userId"),
        agentId: pick("agentId"),
        durationMs: extra.durationMs ?? fields.durationMs ?? null,
        status: extra.status ?? fields.status ?? null,
        errorId: extra.errorId ?? null,
        attrs,
      };
      sink.write(row);
    } catch {
      // La observabilidad nunca tumba el request.
    }
  }

  function error(operation: string, err: unknown, fields: ContextFields = {}): string {
    try {
      const isObject = typeof err === "object" && err !== null;
      const known = isObject ? reported.get(err) : undefined;
      if (known) return known;
      const errorId = randomUUID();
      if (isObject) reported.set(err, errorId);
      const summary = summarizeError(err);
      record(
        "error",
        { ...fields, attrs: { operation: String(operation).slice(0, 200) || "unknown", ...summary } },
        { errorId, level: "error" },
      );
      return errorId;
    } catch {
      return randomUUID();
    }
  }

  async function span<N extends EventName, T>(
    name: N,
    fields: SpanFields<N>,
    fn: (span: SpanHandle<N>) => T | Promise<T>,
  ): Promise<T> {
    const parent = storage.getStore();
    const remote = fields.traceparent !== undefined ? parseTraceparent(fields.traceparent) : null;
    const traceId = remote?.traceId ?? parent?.traceId ?? newTraceId();
    const parentSpanId = remote ? remote.parentSpanId : (parent?.spanId ?? null);
    const spanId = newSpanId();
    // Con un traceparent remoto no se heredan ids del contexto local.
    const inherited = remote ? undefined : parent;
    const ctx: TelemetryContext = {
      traceId,
      spanId,
      requestId: inherited?.requestId ?? null,
      userId: inherited?.userId ?? null,
      agentId: inherited?.agentId ?? null,
      ...definedFields(fields),
    };
    let attrs: Record<string, unknown> = { ...(fields.attrs ?? {}) };
    let status: string | undefined;
    let level: Level | undefined;
    let spanErrorId: string | undefined;
    const handle: SpanHandle<N> = {
      traceId,
      spanId,
      set(more) {
        attrs = { ...attrs, ...(more as Record<string, unknown>) };
      },
      setStatus(value) {
        status = value;
      },
      setLevel(value) {
        level = value;
      },
      setErrorId(value) {
        spanErrorId = value;
      },
    };
    const started = performance.now();
    const finish = (extra: { status: string; level?: Level; errorId?: string }) =>
      record(name, { attrs }, {
        context: ctx,
        traceId,
        spanId,
        parentSpanId,
        durationMs: performance.now() - started,
        status: status ?? extra.status,
        ...(level ?? extra.level ? { level: level ?? extra.level } : {}),
        ...(spanErrorId ?? extra.errorId ? { errorId: spanErrorId ?? extra.errorId } : {}),
      });

    return storage.run(ctx, async () => {
      try {
        const result = await fn(handle);
        finish({ status: "ok" });
        return result;
      } catch (err) {
        const errorId = error(name, err);
        finish({ status: "error", level: "error", errorId });
        throw err;
      }
    });
  }

  function context(): Readonly<TelemetryContext> | undefined;
  function context<T>(fields: ContextFields, fn: () => T): T;
  function context<T>(fields?: ContextFields, fn?: () => T): T | Readonly<TelemetryContext> | undefined {
    const current = storage.getStore();
    if (!fields || !fn) return current ? { ...current } : undefined;
    const next: TelemetryContext = {
      ...(current ?? { traceId: newTraceId(), spanId: null, requestId: null, userId: null, agentId: null }),
      ...definedFields(fields),
    };
    return storage.run(next, fn);
  }

  function traceparent(): string | undefined {
    const ctx = storage.getStore();
    return ctx ? formatTraceparent(ctx.traceId, ctx.spanId ?? newSpanId()) : undefined;
  }

  const lifecycleAttrs = () => ({ version, dropped: sink.stats().dropped });
  const beat = () => record("service.heartbeat", { attrs: lifecycleAttrs() }, { traceId: null, parentSpanId: null });
  let heartbeat: NodeJS.Timeout | null = null;
  if (lifecycle) record("service.started", { attrs: { version } }, { traceId: null, parentSpanId: null });
  if (lifecycle && heartbeatMs > 0) {
    beat();
    heartbeat = setInterval(beat, heartbeatMs);
    heartbeat.unref();
  }

  let shuttingDown: Promise<void> | null = null;

  return {
    service,
    instance,
    version,
    emit(name, fields) {
      record(name, fields ?? {}, {});
    },
    span,
    error,
    context,
    identify(fields) {
      const current = storage.getStore();
      if (current) Object.assign(current, definedFields(fields));
    },
    traceparent,
    stats: () => sink.stats(),
    flush: () => sink.flush().catch(() => undefined),
    shutdown() {
      shuttingDown ??= (async () => {
        if (heartbeat) clearInterval(heartbeat);
        if (lifecycle) record("service.stopping", { attrs: lifecycleAttrs() }, { traceId: null, parentSpanId: null });
        closed = true;
        await sink.close().catch(() => undefined);
      })();
      return shuttingDown;
    },
  };
}
