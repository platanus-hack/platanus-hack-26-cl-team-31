import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { WAKE_EVENT } from "@team-31/protocol";
import { createTelemetry, memorySink } from "@team-31/telemetry";
import { afterEach, describe, expect, it } from "vitest";
import { createWaker } from "./index.js";

const servers: Server[] = [];
const secret = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const notice = { requestId: "req_telemetry", event: WAKE_EVENT } as const;

async function receiver(status: number) {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(status).end("cuerpo privado del receptor");
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto del receptor");
  return `http://127.0.0.1:${address.port}/hook`;
}

function setup() {
  const sink = memorySink();
  const telemetry = createTelemetry({ service: "worker", sink, heartbeatMs: 0, lifecycle: false });
  return { sink, waker: createWaker({ allowInsecure: true, telemetry }) };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

describe("telemetría del aviso", () => {
  it("registra cada intento como span wake.attempt sin secretos ni URL", async () => {
    const { sink, waker } = setup();
    const url = await receiver(202);
    await waker.wake({ kind: "standard_webhook", url, secret }, notice, { attempt: 1, queueWaitMs: 250, final: false, userId: "u1", agentId: "a1" });

    const [span] = sink.find("wake.attempt");
    expect(span).toMatchObject({
      kind: "wake", requestId: notice.requestId, userId: "u1", agentId: "a1", status: "ok",
      attrs: { kind: "standard_webhook", attempt: 1, queueWaitMs: 250, ok: true, httpStatus: 202, code: "ok" },
    });
    expect(span?.durationMs).toEqual(expect.any(Number));
    expect(sink.find("wake.exhausted")).toHaveLength(0);
    const serialized = JSON.stringify(sink.records);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(url);
  });

  it("registra el sondeo como intento propio, distinguible de la ausencia de canal", async () => {
    const { sink, waker } = setup();
    await waker.wake({ kind: "polling" }, notice, { attempt: 1, final: false, userId: "u1", agentId: "a1" });

    const [span] = sink.find("wake.attempt");
    expect(span).toMatchObject({
      kind: "wake", requestId: notice.requestId, userId: "u1", agentId: "a1", status: "ok",
      attrs: { kind: "polling", attempt: 1, ok: true, code: "ok" },
    });
    expect(span?.attrs).not.toHaveProperty("httpStatus");
    expect(sink.find("wake.exhausted")).toHaveLength(0);
  });

  it("marca un fallo reintentable y emite wake.exhausted en el último intento", async () => {
    const { sink, waker } = setup();
    const url = await receiver(503);
    const target = { kind: "standard_webhook", url, secret } as const;
    await waker.wake(target, notice, { attempt: 1, final: false });
    expect(sink.find("wake.exhausted")).toHaveLength(0);
    await waker.wake(target, notice, { attempt: 3, final: true });

    expect(sink.find("wake.attempt").map((span) => [span.status, span.attrs.httpStatus, span.attrs.code])).toEqual([
      ["failed", 503, "http_error"],
      ["failed", 503, "http_error"],
    ]);
    expect(sink.find("wake.exhausted")).toEqual([
      expect.objectContaining({ requestId: notice.requestId, attrs: { kind: "standard_webhook", attempts: 3 } }),
    ]);
    expect(JSON.stringify(sink.records)).not.toContain("cuerpo privado");
  });

  it("un fallo no reintentable agota los avisos aunque queden intentos", async () => {
    const { sink, waker } = setup();
    await waker.wake({ kind: "standard_webhook", url: "https://user:pass@example.com/hook", secret }, notice, { attempt: 1, final: false });
    expect(sink.find("wake.attempt")[0]?.attrs).toMatchObject({ ok: false, code: "blocked_address" });
    expect(sink.find("wake.exhausted")).toHaveLength(1);
  });
});
