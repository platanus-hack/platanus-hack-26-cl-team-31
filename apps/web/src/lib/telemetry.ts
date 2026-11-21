import "server-only";

import { createTelemetry, type SpanHandle, type Telemetry } from "@team-31/telemetry";
import { headers } from "next/headers";

let telemetry: Telemetry | undefined;

export function webTelemetry(): Telemetry {
  return (telemetry ??= createTelemetry({ service: "web" }));
}

export async function observeWebRequest<T>(
  method: "GET" | "POST",
  route: string,
  run: (span: SpanHandle<"http.request">) => T | Promise<T>,
): Promise<T> {
  const traceparent = (await headers()).get("traceparent");
  return webTelemetry().span("http.request", { traceparent, attrs: { method, route } }, run);
}
