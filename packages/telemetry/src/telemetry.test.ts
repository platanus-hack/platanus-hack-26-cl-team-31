import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { memorySink } from "./sinks/memory.js";
import { createTelemetry, type Telemetry } from "./telemetry.js";
import type { TelemetrySink } from "./types.js";

const open: Telemetry[] = [];
function setup(options: { heartbeatMs?: number; lifecycle?: boolean } = {}) {
  const sink = memorySink();
  const telemetry = createTelemetry({ service: "broker", version: "1.2.3", sink, heartbeatMs: 0, lifecycle: false, ...options });
  open.push(telemetry);
  return { sink, telemetry };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((telemetry) => telemetry.shutdown()));
  vi.useRealTimers();
});

describe("emit", () => {
  it("descarta los attrs no declarados (redacción)", () => {
    const { sink, telemetry } = setup();
    telemetry.emit("broker.request.created", {
      requestId: "req_1",
      userId: "u_1",
      // @ts-expect-error authorization y args no están en el catálogo
      attrs: { tool: "availability", rule: "contacts", authorization: "Bearer secret", args: "pregunta privada" },
    });
    const [row] = sink.find("broker.request.created");
    expect(row).toMatchObject({ service: "broker", kind: "lifecycle", level: "info", requestId: "req_1", userId: "u_1" });
    expect(row!.attrs).toEqual({ tool: "availability", rule: "contacts" });
    expect(JSON.stringify(sink.records)).not.toMatch(/secret|privada/);
  });

  it("guarda sin attrs un evento inválido y emite telemetry.invalid_event", () => {
    const { sink, telemetry } = setup();
    // @ts-expect-error outcome fuera del enum
    telemetry.emit("mcp.tool.call", { attrs: { tool: "ask", outcome: "maybe" } });
    expect(sink.find("mcp.tool.call")[0]!.attrs).toEqual({});
    const [invalid] = sink.find("telemetry.invalid_event");
    expect(invalid).toMatchObject({ level: "warn", attrs: { event: "mcp.tool.call" } });
    expect(String(invalid!.attrs.issues)).toContain("outcome");
  });

  it("no guarda un evento desconocido, pero avisa", () => {
    const { sink, telemetry } = setup();
    (telemetry.emit as (name: string) => void)("no.existe");
    expect(sink.find("no.existe")).toHaveLength(0);
    expect(sink.find("telemetry.invalid_event")[0]!.attrs).toMatchObject({ event: "no.existe", issues: "unknown_event" });
  });

  it("nunca lanza, aunque el sink falle", () => {
    const broken: TelemetrySink = {
      write: () => { throw new Error("boom"); },
      flush: async () => { throw new Error("boom"); },
      close: async () => { throw new Error("boom"); },
      stats: () => ({ queued: 0, dropped: 0, failed: 0, written: 0 }),
    };
    const telemetry = createTelemetry({ service: "mcp", sink: broken, heartbeatMs: 0 });
    expect(() => telemetry.emit("service.heartbeat", { attrs: { version: "x" } })).not.toThrow();
    expect(() => telemetry.error("op", new Error("x"))).not.toThrow();
    return expect(Promise.all([telemetry.flush(), telemetry.shutdown()])).resolves.toBeDefined();
  });

  it("rechaza un servicio fuera del contrato al crear", () => {
    expect(() => createTelemetry({ service: "nope" as never, sink: memorySink(), heartbeatMs: 0 })).toThrow();
  });
});

describe("contexto y spans", () => {
  it("anida spans y hereda ids de correlación", async () => {
    const { sink, telemetry } = setup();
    let inner: { traceId: string; spanId: string } | undefined;
    await telemetry.span("http.request", { requestId: "req_9", attrs: { method: "POST" } }, async (outer) => {
      telemetry.identify({ userId: "u_7" });
      await telemetry.span("wake.attempt", {}, async (span) => {
        inner = { traceId: span.traceId, spanId: span.spanId };
        span.set({ httpStatus: 202, ok: true });
        telemetry.emit("broker.request.status_changed", { attrs: { from: "queued", to: "awaiting_agent", by: "broker" } });
      });
      expect(inner!.traceId).toBe(outer.traceId);
    });
    const http = sink.find("http.request")[0]!;
    const wake = sink.find("wake.attempt")[0]!;
    const changed = sink.find("broker.request.status_changed")[0]!;
    expect(http).toMatchObject({ parentSpanId: null, status: "ok", requestId: "req_9", userId: "u_7", attrs: { method: "POST" } });
    expect(http.durationMs).toBeGreaterThanOrEqual(0);
    expect(wake).toMatchObject({ traceId: http.traceId, parentSpanId: http.spanId, requestId: "req_9", userId: "u_7", attrs: { httpStatus: 202, ok: true } });
    expect(changed).toMatchObject({ traceId: http.traceId, spanId: null, parentSpanId: wake.spanId, requestId: "req_9" });
  });

  it("si la función lanza, registra el error una sola vez y relanza", async () => {
    const { sink, telemetry } = setup();
    const failure = new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2");
    await expect(telemetry.span("wake.attempt", { requestId: "req_2" }, () => { throw failure; })).rejects.toBe(failure);
    const span = sink.find("wake.attempt")[0]!;
    expect(span).toMatchObject({ status: "error", level: "error" });
    // El manejador del servicio recibe el mismo errorId que quedó en el span.
    expect(telemetry.error("POST /v1/agent/ask", failure)).toBe(span.errorId);
    expect(sink.find("error")).toHaveLength(1);
    expect(sink.find("error")[0]).toMatchObject({ errorId: span.errorId, requestId: "req_2", traceId: span.traceId });
  });

  it("context() agrega ids y traceparent() refleja el span activo", async () => {
    const { telemetry } = setup();
    expect(telemetry.context()).toBeUndefined();
    expect(telemetry.traceparent()).toBeUndefined();
    await telemetry.context({ requestId: "req_3" }, async () => {
      expect(telemetry.context()).toMatchObject({ requestId: "req_3", spanId: null });
      await telemetry.span("wake.attempt", {}, (span) => {
        expect(telemetry.traceparent()).toBe(`00-${span.traceId}-${span.spanId}-01`);
      });
    });
  });

  it("continúa un traceparent remoto válido e ignora uno inválido", async () => {
    const { sink, telemetry } = setup();
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    await telemetry.span("http.request", { traceparent: `00-${traceId}-00f067aa0ba902b7-01` }, () => undefined);
    await telemetry.span("http.request", { traceparent: "00-zzzz-00f067aa0ba902b7-01" }, () => undefined);
    const [remote, fresh] = sink.find("http.request");
    expect(remote).toMatchObject({ traceId, parentSpanId: "00f067aa0ba902b7" });
    expect(fresh!.traceId).not.toBe(traceId);
    expect(fresh!.parentSpanId).toBeNull();
  });
});

describe("error()", () => {
  it("no incluye mensajes crudos, causas ni valores", () => {
    const { sink, telemetry } = setup();
    const secret = "Bearer eyJhbGciOi.secret-token";
    const failure = Object.assign(new TypeError(`no pude leer ${secret}`, { cause: new Error(secret) }), { code: "ECONNRESET", detail: secret });
    const errorId = telemetry.error("POST /v1/agent/reply", failure, { requestId: "req_4" });
    const [row] = sink.find("error");
    expect(errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({ kind: "error", level: "error", errorId, requestId: "req_4" });
    expect(row!.attrs).toMatchObject({ operation: "POST /v1/agent/reply", type: "TypeError", code: "ECONNRESET" });
    // Solo frames del repo, relativos (sin la ruta absoluta del host).
    expect(String(row!.attrs.frames)).toMatch(/^packages\/telemetry\/src\/telemetry\.test\.ts:\d+:\d+/);
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(JSON.stringify(row)).not.toContain("no pude leer");
    expect(JSON.stringify(row)).not.toContain(process.cwd());
  });

  it("resume un ZodError con los códigos de sus issues", () => {
    const { sink, telemetry } = setup();
    const parsed = z.object({ email: z.email(), age: z.number() }).safeParse({ email: "ana@private.cl x", age: "41" });
    telemetry.error("POST /v1/owner/rules", parsed.error);
    const attrs = sink.find("error")[0]!.attrs;
    expect(attrs).toMatchObject({ type: "invalid_schema", issues: "invalid_format,invalid_type" });
    expect(JSON.stringify(attrs)).not.toContain("ana@private.cl");
  });

  it("acepta valores que no son Error", () => {
    const { sink, telemetry } = setup();
    telemetry.error("worker.tick", "texto con secreto");
    telemetry.error("worker.tick", null);
    expect(sink.find("error").map((row) => row.attrs.type)).toEqual(["string", "null"]);
    expect(JSON.stringify(sink.records)).not.toContain("secreto");
  });
});

describe("ciclo de vida", () => {
  it("emite service.started, un latido cada 30 s y service.stopping", async () => {
    vi.useFakeTimers();
    const { sink, telemetry } = setup({ heartbeatMs: undefined, lifecycle: true });
    expect(sink.find("service.started")[0]).toMatchObject({ kind: "lifecycle", attrs: { version: "1.2.3" }, traceId: null });
    expect(sink.find("service.heartbeat")).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    expect(sink.find("service.heartbeat")).toHaveLength(3);
    expect(sink.find("service.heartbeat")[0]!.attrs).toEqual({ version: "1.2.3", dropped: 0 });
    expect(sink.records[0]!.instance).toMatch(/:\d+$/);
    await telemetry.shutdown();
    expect(sink.find("service.stopping")).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    telemetry.emit("service.heartbeat");
    expect(sink.find("service.heartbeat")).toHaveLength(3);
  });
});
