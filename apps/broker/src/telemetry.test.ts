import { generateKeyPairSync } from "node:crypto";
import { mintServiceToken } from "@team-31/auth/service";
import { Scope } from "@team-31/protocol";
import { memorySink, type MemorySink } from "@team-31/telemetry";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { composeBroker } from "./compose.js";
import { readEnv } from "./env.js";
import { createHttpServer } from "./http/server.js";
import { createBrokerTelemetry, type BrokerServiceTelemetry } from "./telemetry.js";

const mcp = generateKeyPairSync("ed25519");
const web = generateKeyPairSync("ed25519");
const signing = generateKeyPairSync("ed25519");
const publicKeys = { mcp: mcp.publicKey.export({ format: "jwk" }), web: web.publicKey.export({ format: "jwk" }) };
const env = readEnv({
  BROKER_PORT: "1",
  BROKER_SIGNING_KEY: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
  SERVICE_JWT_PUBLIC_KEYS: JSON.stringify(publicKeys),
  NONCE_KEY: Buffer.alloc(32).toString("base64"),
});
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const traceparent = `00-${traceId}-00f067aa0ba902b7-01`;
const secretText = "pregunta privada";

const agentToken = (sub: string) => mintServiceToken({
  iss: "mcp", sub, azp: `${sub}-bot`, scopes: Scope.options, privateKey: mcp.privateKey.export({ format: "jwk" }),
});

let sink: MemorySink;
let telemetry: BrokerServiceTelemetry;
let service: ReturnType<typeof composeBroker>;
let app: ReturnType<typeof createHttpServer>;

beforeEach(async () => {
  sink = memorySink();
  telemetry = createBrokerTelemetry({ sink, heartbeatMs: 0, version: "test" });
  onTestFinished(() => telemetry.shutdown());
  service = composeBroker(env, telemetry);
  onTestFinished(service.close);
  const { broker, limiter } = service;
  app = createHttpServer({ broker, limiter, publicKeys: env.SERVICE_JWT_PUBLIC_KEYS, telemetry: telemetry.http });
  await broker.owner.claimAddress({ userId: "alice" }, "alice");
  await broker.owner.claimAddress({ userId: "bruno" }, "bruno");
  await broker.owner.setGrant({ userId: "bruno" }, { grantee: "alice@sideband.app", category: "general" });
  sink.clear();
});

function ask(headers: Record<string, string>) {
  return app.request("/v1/agent/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ to: "bruno@sideband.app", tool: "question", args: { text: secretText, category: "general" } }),
  });
}

describe("telemetría del broker HTTP", () => {
  it("continúa la traza entrante y correlaciona el span con usuario, agente y solicitud", async () => {
    const response = await ask({ Authorization: `Bearer ${await agentToken("alice")}`, traceparent });
    expect(response.status).toBe(200);
    const { requestId } = await response.json() as { requestId: string };
    expect(response.headers.get("X-Trace-Id")).toBe(traceId);

    const [span] = sink.find("http.request");
    expect(span).toMatchObject({
      service: "broker", traceId, parentSpanId: "00f067aa0ba902b7", userId: "alice", agentId: "alice-bot", requestId,
      attrs: { method: "POST", route: "/v1/agent/ask", status: 200, bucket: "2xx" },
    });
    for (const name of ["broker.policy.evaluated", "broker.request.created"]) {
      expect(sink.find(name)).toEqual([expect.objectContaining({ service: "broker", traceId, requestId, parentSpanId: span?.spanId })]);
    }
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain("Bearer");
  });

  it("registra JWT de servicio rechazados con un código y sin errores internos", async () => {
    expect((await ask({})).status).toBe(401);
    const webToken = await mintServiceToken({ iss: "web", sub: "alice", privateKey: web.privateKey.export({ format: "jwk" }) });
    expect((await ask({ Authorization: `Bearer ${webToken}` })).status).toBe(401);

    expect(sink.find("auth.service_jwt.rejected").map((record) => record.attrs)).toEqual([
      { expectedIss: "mcp", reason: "missing_token" },
      { expectedIss: "mcp", reason: expect.stringMatching(/^ERR_/) },
    ]);
    expect(sink.find("error")).toEqual([]);
    expect(JSON.stringify(sink.records)).not.toContain(webToken);
  });

  it("registra el límite de tasa con la ruta y el grupo", async () => {
    const token = await agentToken("alice");
    for (let i = 0; i < 30; i++) await service.limiter.consume("alice", "ask");
    expect((await ask({ Authorization: `Bearer ${token}` })).status).toBe(429);
    expect(sink.find("http.rate_limited")).toEqual([
      expect.objectContaining({ level: "warn", userId: "alice", attrs: { route: "/v1/agent/ask", bucket: "ask" } }),
    ]);
  });

  it("separa los eventos del worker de los del HTTP en un mismo proceso", async () => {
    const { broker } = service;
    await broker.agent.inbox({ userId: "bruno", agentId: "bruno-bot", scopes: ["sideband:inbox"] });
    const response = await ask({ Authorization: `Bearer ${await agentToken("alice")}` });
    expect(response.status).toBe(200);
    const { requestId, expiresAt } = await response.json() as { requestId: string; expiresAt: string };
    await telemetry.runInWorker(() => broker.tick(new Date()));
    await telemetry.runInWorker(() => broker.tick(new Date(expiresAt)));

    expect(sink.find("broker.request.created")).toMatchObject([{ service: "broker", requestId }]);
    expect(sink.find("wake.attempt")).toMatchObject([{
      service: "worker", requestId, userId: "bruno", agentId: "bruno-bot",
      attrs: { kind: "polling", attempt: 1, ok: true },
    }]);
    expect(sink.find("broker.request.status_changed")).toEqual([
      expect.objectContaining({ service: "worker", requestId, attrs: { from: "awaiting_agent", to: "expired", by: "broker" } }),
    ]);
  });

  it("cada servicio emite su latido y se detiene una sola vez", async () => {
    const own = memorySink();
    const service = createBrokerTelemetry({ sink: own, heartbeatMs: 60_000, version: "1.2.3" });
    await service.shutdown();
    const lifecycle = (name: string) => own.find(name).map((record) => record.service).sort();
    expect(lifecycle("service.started")).toEqual(["broker", "worker"]);
    expect(lifecycle("service.heartbeat")).toEqual(["broker", "worker"]);
    expect(lifecycle("service.stopping")).toEqual(["broker", "worker"]);
    expect(own.find("service.started")[0]?.attrs).toEqual({ version: "1.2.3" });
  });
});
