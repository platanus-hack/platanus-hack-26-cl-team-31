import type { Telemetry } from "./telemetry.js";

/**
 * Envuelve fetch para llamadas internas (web → broker, mcp → broker, admin → broker):
 * agrega el encabezado W3C traceparent del contexto activo. No pisa un traceparent explícito.
 */
export function tracedFetch(
  telemetry: Pick<Telemetry, "traceparent">,
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) => {
    const traceparent = telemetry.traceparent();
    if (!traceparent) return baseFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("traceparent")) headers.set("traceparent", traceparent);
    return baseFetch(input, { ...init, headers });
  };
}
