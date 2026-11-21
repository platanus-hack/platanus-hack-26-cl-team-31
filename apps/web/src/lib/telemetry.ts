// Telemetry of the web server (docs/admin.md#3). Server only: Next has no Hono, so route handlers
// use observeRoute() and server components and actions get a trace from the broker client.
// Without "server-only" on purpose: instrumentation.ts imports it outside the React server layer.
import { createTelemetry, type SpanHandle, type Telemetry } from "@team-31/telemetry";
import { headers } from "next/headers";

const holder = globalThis as unknown as { __sidebandWebTelemetry?: Telemetry };

/** One instance per server process, also across dev reloads (emits service.started once). */
export function getTelemetry(): Telemetry {
  holder.__sidebandWebTelemetry ??= createTelemetry({ service: "web", version: process.env.npm_package_version });
  return holder.__sidebandWebTelemetry;
}

export function emptyResponse(status: number, errorId?: string): Response {
  return new Response(null, { status, headers: errorId ? { "X-Error-Id": errorId } : undefined });
}

/**
 * Span http.request for a route handler. route is the file pattern (never the raw path). An
 * unexpected error answers 500 with X-Error-Id instead of escaping without a trace.
 */
export async function observeRoute(request: Request, route: string, handler: () => Promise<Response>): Promise<Response> {
  const telemetry = getTelemetry();
  return telemetry.span("http.request", {
    traceparent: request.headers.get("traceparent"),
    attrs: { method: request.method, route },
  }, async (span) => {
    let response: Response;
    try {
      response = await handler();
    } catch (error) {
      const errorId = telemetry.error(`${request.method} ${route}`, error);
      span.setErrorId(errorId);
      response = Response.json(
        { error: { code: "internal", errorId } },
        { status: 500, headers: { "Cache-Control": "no-store", "X-Error-Id": errorId } },
      );
    }
    span.set({ status: response.status, bucket: `${Math.floor(response.status / 100)}xx` });
    if (response.status >= 500) {
      span.setStatus("error");
      span.setLevel("error");
    }
    try {
      response.headers.set("X-Trace-Id", span.traceId);
    } catch {
      // Redirect responses have immutable headers: the span still records the trace.
    }
    return response;
  });
}

/** Keeps multiple calls in a server component or action under the same request trace. */
export async function observeWebRequest<T>(
  method: "GET" | "POST",
  route: string,
  run: (span: SpanHandle<"http.request">) => T | Promise<T>,
): Promise<T> {
  const traceparent = (await headers()).get("traceparent");
  return getTelemetry().span("http.request", { traceparent, attrs: { method, route } }, run);
}
