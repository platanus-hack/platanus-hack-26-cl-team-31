import { createTelemetry, memorySink } from "@team-31/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as login from "./dev-login/route";
import * as token from "./dev-token/route";

vi.mock("../../lib/auth", () => ({ getAuth: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  { route: "/api/dev-login", handlers: login },
  { route: "/api/dev-token", handlers: token },
])("$route", ({ route, handlers }) => {
  it.each([
    { method: "GET", enabled: true, status: 200 },
    { method: "GET", enabled: false, status: 404 },
    { method: "POST", enabled: false, status: 404 },
  ] as const)("registra $method con HTTP $status", async ({ method, enabled, status }) => {
    vi.stubEnv("SIDEBAND_DEV_AUTH", enabled ? "1" : undefined);
    const sink = memorySink();
    vi.stubGlobal("__sidebandWebTelemetry", createTelemetry({ service: "web", sink, lifecycle: false }));
    const traceId = "0123456789abcdef0123456789abcdef";
    const request = new Request(new URL(route, "https://sideband.test"), {
      method,
      headers: { traceparent: `00-${traceId}-0123456789abcdef-01` },
    });

    const response = await handlers[method](request);

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(enabled ? { enabled: true } : { error: { code: "not_found" } });
    expect(response.headers.get("X-Trace-Id")).toBe(traceId);
    expect(sink.find("http.request")).toMatchObject([{ traceId, attrs: { method, route, status } }]);
  });
});
