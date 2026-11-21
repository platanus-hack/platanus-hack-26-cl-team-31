import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tracedFetch } from "./fetch.js";
import { honoTelemetry } from "./hono.js";
import { memorySink } from "./sinks/memory.js";
import { createTelemetry } from "./telemetry.js";

// Dos servicios en el mismo proceso: "mcp" llama a "broker" con tracedFetch. El fetch de mcp
// se enruta directo a broker.fetch, así el traceparent viaja como encabezado HTTP real.
function twoServices() {
  const brokerSink = memorySink();
  const mcpSink = memorySink();
  const brokerTelemetry = createTelemetry({ service: "broker", sink: brokerSink, heartbeatMs: 0, lifecycle: false });
  const mcpTelemetry = createTelemetry({ service: "mcp", sink: mcpSink, heartbeatMs: 0, lifecycle: false });
  const seen: { traceparent?: string | undefined; authorization?: string | undefined } = {};

  const broker = new Hono();
  broker.use(honoTelemetry(brokerTelemetry));
  broker.post("/v1/agent/ask/:id", (c) => {
    seen.traceparent = c.req.header("traceparent");
    seen.authorization = c.req.header("authorization");
    brokerTelemetry.emit("broker.request.created", { requestId: c.req.param("id"), attrs: { tool: "availability" } });
    return c.json({ ok: true }, 201);
  });
  broker.get("/boom", () => {
    throw new Error("fallo con token=abc");
  });
  broker.get("/healthz", (c) => c.text("ok"));

  const fetchBroker = tracedFetch(mcpTelemetry, (input, init) => Promise.resolve(broker.fetch(new Request(input, init))));
  const mcp = new Hono();
  mcp.use(honoTelemetry(mcpTelemetry));
  mcp.post("/mcp", async (c) => {
    const response = await fetchBroker(new Request("http://broker.internal/v1/agent/ask/req_42", {
      method: "POST",
      headers: { authorization: "Bearer service-jwt" },
    }));
    return c.json({ status: response.status, traceId: response.headers.get("x-trace-id") });
  });

  return { broker, mcp, brokerSink, mcpSink, seen };
}

describe("honoTelemetry + tracedFetch", () => {
  it("propaga traceparent entre dos apps Hono", async () => {
    const { mcp, brokerSink, mcpSink, seen } = twoServices();
    const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const response = await mcp.request("/mcp", { method: "POST", headers: { traceparent: incoming } });
    expect(response.status).toBe(200);
    const body = await response.json() as { status: number; traceId: string };

    const mcpSpan = mcpSink.find("http.request")[0]!;
    const brokerSpan = brokerSink.find("http.request")[0]!;
    // La traza del cliente externo cruza mcp y broker.
    expect(mcpSpan).toMatchObject({ service: "mcp", traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7" });
    expect(brokerSpan).toMatchObject({ service: "broker", traceId: mcpSpan.traceId, parentSpanId: mcpSpan.spanId, status: "ok" });
    expect(seen.traceparent).toBe(`00-${mcpSpan.traceId}-${mcpSpan.spanId}-01`);
    // tracedFetch conserva los encabezados del Request original.
    expect(seen.authorization).toBe("Bearer service-jwt");
    expect(response.headers.get("x-trace-id")).toBe(mcpSpan.traceId);
    expect(body).toEqual({ status: 201, traceId: mcpSpan.traceId });

    expect(brokerSpan.attrs).toEqual({ method: "POST", route: "/v1/agent/ask/:id", status: 201, bucket: "2xx" });
    expect(mcpSpan.attrs).toEqual({ method: "POST", route: "/mcp", status: 200, bucket: "2xx" });
    const created = brokerSink.find("broker.request.created")[0]!;
    expect(created).toMatchObject({ traceId: mcpSpan.traceId, parentSpanId: brokerSpan.spanId, requestId: "req_42" });
  });

  it("registra el error del handler y responde X-Error-Id sin el mensaje", async () => {
    const { broker, brokerSink } = twoServices();
    const response = await broker.request("/boom");
    expect(response.status).toBe(500);
    const errorId = response.headers.get("x-error-id");
    const [error] = brokerSink.find("error");
    const span = brokerSink.find("http.request")[0]!;
    expect(errorId).toBe(error!.errorId);
    expect(span).toMatchObject({ status: "error", level: "error", errorId, attrs: { route: "/boom", status: 500, bucket: "5xx" } });
    expect(error!.attrs).toMatchObject({ operation: "GET /boom", type: "Error" });
    expect(JSON.stringify(brokerSink.records)).not.toContain("token=abc");
  });

  it("usa el patrón y no la ruta cruda, e ignora /healthz", async () => {
    const { broker, brokerSink } = twoServices();
    await broker.request("/healthz");
    await broker.request("/v1/users/ana@nexo.cl/secret?token=x");
    const spans = brokerSink.find("http.request");
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attrs).toMatchObject({ route: "unmatched", status: 404, bucket: "4xx" });
    expect(JSON.stringify(brokerSink.records)).not.toContain("ana@nexo.cl");
  });

  it("tracedFetch no agrega nada fuera de una traza ni pisa un traceparent explícito", async () => {
    const telemetry = createTelemetry({ service: "web", sink: memorySink(), heartbeatMs: 0, lifecycle: false });
    const headersSeen: Array<string | null> = [];
    const fetchSpy = tracedFetch(telemetry, async (_input, init) => {
      headersSeen.push(new Headers(init?.headers).get("traceparent"));
      return new Response(null, { status: 204 });
    });
    await fetchSpy("http://broker.internal/x");
    const explicit = "00-11111111111111111111111111111111-2222222222222222-01";
    await telemetry.span("http.request", {}, async () => {
      await fetchSpy("http://broker.internal/x", { headers: { traceparent: explicit } });
      await fetchSpy("http://broker.internal/x");
    });
    expect(headersSeen[0]).toBeNull();
    expect(headersSeen[1]).toBe(explicit);
    expect(headersSeen[2]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});
