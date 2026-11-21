import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Telemetry } from "./telemetry.js";

export interface HonoTelemetryOptions {
  /** Rutas que no generan span (por defecto /healthz, para no inundar ops.events). */
  ignore?: (path: string) => boolean;
}

const defaultIgnore = (path: string) => path === "/healthz";

/**
 * Middleware para todo servidor Hono: abre el span `http.request`, continúa la traza del
 * encabezado traceparent entrante, responde X-Trace-Id y, si el handler falló, registra el
 * error y responde X-Error-Id. route es el patrón registrado, nunca la ruta cruda.
 */
export function honoTelemetry(telemetry: Telemetry, options: HonoTelemetryOptions = {}): MiddlewareHandler {
  const ignore = options.ignore ?? defaultIgnore;
  return async (c, next) => {
    if (ignore(c.req.path)) return next();
    await telemetry.span(
      "http.request",
      { traceparent: c.req.header("traceparent") ?? null, attrs: { method: c.req.method } },
      async (span) => {
        c.header("X-Trace-Id", span.traceId);
        await next();
        const status = c.res.status;
        const matched = routePath(c);
        const route = status === 404 && matched.endsWith("*") ? "unmatched" : matched;
        span.set({ route, status, bucket: `${Math.floor(status / 100)}xx` });
        if (c.error) {
          const errorId = telemetry.error(`${c.req.method} ${route}`, c.error);
          span.setErrorId(errorId);
          if (!c.res.headers.has("X-Error-Id")) c.header("X-Error-Id", errorId);
        }
        if (status >= 500) {
          span.setStatus("error");
          span.setLevel("error");
        }
      },
    );
  };
}
