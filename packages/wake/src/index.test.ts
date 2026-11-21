import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WAKE_EVENT, type WakeTarget } from "@team-31/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWaker } from "./index.js";
import { createSafeFetch } from "./safe-fetch.js";
import { verify } from "./standard-webhooks.js";

const notice = { requestId: "req_123", event: WAKE_EVENT, args: { text: "Una pregunta privada" } } as const;
const secret = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const instruction = 'Tienes una solicitud nueva en Nexo (req_123). Usa nexo_inbox para leerla y respóndela con nexo_reply usando su requestId y nonce. Siempre debes responder: si no tienes la información usa outcome "no_data", si necesitas que tu dueño decida usa "needs_owner" y si prefieres no compartir usa "declined". Comparte solo los campos permitidos.';
const fixedTime = new Date("2026-01-01T00:00:00.000Z");
const waker = createWaker({ allowInsecure: true });
const servers: Server[] = [];

interface CapturedRequest {
  method: IncomingMessage["method"];
  path: IncomingMessage["url"];
  headers: IncomingMessage["headers"];
  body: string;
}

async function startReceiver(
  respond: (request: CapturedRequest, response: ServerResponse) => void = (_request, response) => response.end(),
) {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const entry = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    };
    captured.push(entry);
    respond(entry, response);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Falta el puerto del receptor");
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, captured };
}

function expectRequest(
  captured: CapturedRequest[],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  expect(captured).toHaveLength(1);
  const request = captured[0]!;
  expect(request.method).toBe("POST");
  expect(request.path).toBe(path);
  expect(request.headers).toMatchObject({
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(request.body)),
    ...headers,
  });
  expect(JSON.parse(request.body)).toEqual(body);
  expect(request.body).not.toContain(notice.args.text);
  expect(request.body).not.toContain(secret);
  return request;
}

function expectSignature(request: CapturedRequest, id: string, timestamp: number) {
  expect(request.headers).toMatchObject({
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": expect.stringMatching(/^v1,[A-Za-z0-9+/]+=*$/),
  });
  expect(verify(secret, id, timestamp, request.body, String(request.headers["webhook-signature"]))).toBe(true);
}

function mcpTarget(callbackUrl: string): Extract<WakeTarget, { kind: "mcp_events" }> {
  return { kind: "mcp_events", callbackUrl, secret, subscriptionId: "sub_abcd", refreshBefore: null };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

describe("wake", () => {
  it("avisa a OpenClaw en /hooks/agent con Bearer e idempotencia", async () => {
    const { port, captured } = await startReceiver();
    const token = "credencial-de-prueba";
    const result = await waker.wake({
      kind: "openclaw_hooks", baseUrl: `http://localhost:${port}/gateway/`, token, agentId: "casa",
    }, notice);
    expect(result).toMatchObject({ ok: true, status: 200, retryable: false, ms: expect.any(Number) });
    const request = expectRequest(captured, "/gateway/hooks/agent", {
      message: instruction, name: "Nexo", agentId: "casa", deliver: false, timeoutSeconds: 180,
    }, { authorization: `Bearer ${token}`, "idempotency-key": notice.requestId, host: `localhost:${port}` });
    expect(request.body).not.toContain(token);
  });

  it("dispara la rutina Grok Bot con Bearer y conserva el query", async () => {
    const { url, captured } = await startReceiver();
    const key = "credencial-de-prueba";
    await expect(waker.wake({ kind: "grokbot_routine", url: url + "/routine?mode=wake", key }, notice))
      .resolves.toMatchObject({ ok: true, status: 200, retryable: false });
    const request = expectRequest(captured, "/routine?mode=wake", {
      event: notice.event, requestId: notice.requestId, instruction,
    }, { authorization: `Bearer ${key}` });
    expect(request.body).not.toContain(key);
  });

  it("envía únicamente el aviso firmado a un Standard Webhook", async () => {
    const { url, captured } = await startReceiver((_request, response) => {
      response.writeHead(202).end();
    });
    vi.setSystemTime(fixedTime);
    await expect(waker.wake({ kind: "standard_webhook", url: url + "/webhook", secret }, notice))
      .resolves.toMatchObject({ ok: true, status: 202, retryable: false });
    const request = expectRequest(captured, "/webhook", { event: notice.event, requestId: notice.requestId });
    expect(request.headers.authorization).toBeUndefined();
    expectSignature(request, "evt_req_123", fixedTime.getTime() / 1000);
  });

  it("entrega un MCP Event firmado para su suscripción", async () => {
    const { url, captured } = await startReceiver();
    vi.setSystemTime(fixedTime);
    await expect(waker.wake(mcpTarget(url + "/events"), notice))
      .resolves.toMatchObject({ ok: true, status: 200, retryable: false });
    const request = expectRequest(captured, "/events", {
      eventId: "evt_req_123",
      name: notice.event,
      timestamp: fixedTime.toISOString(),
      data: { requestId: notice.requestId },
      cursor: null,
    }, { "x-mcp-subscription-id": "sub_abcd" });
    expectSignature(request, "evt_req_123", fixedTime.getTime() / 1000);
  });

  it("clasifica 202 como fallo de Grok Bot", async () => {
    const { url } = await startReceiver((_request, response) => response.writeHead(202).end());
    await expect(waker.wake({ kind: "grokbot_routine", url, key: "credencial-de-prueba" }, notice))
      .resolves.toMatchObject({ ok: false, status: 202, retryable: false });
  });

  it("acepta el modo sin aviso", async () => {
    await expect(waker.wake({ kind: "none" }, notice))
      .resolves.toEqual({ ok: true, retryable: false, ms: expect.any(Number) });
  });

  it.each([
    [400, false], [401, false], [408, true], [425, true], [429, true], [500, true], [503, true],
  ])("clasifica HTTP %s sin incluir la respuesta del servidor", async (status, retryable) => {
    const { url } = await startReceiver((_request, response) => response.writeHead(status).end(secret));
    await expect(waker.wake({ kind: "standard_webhook", url, secret }, notice))
      .resolves.toEqual({ ok: false, status, retryable, ms: expect.any(Number) });
  });

  it("rechaza una redirección sin enviar la solicitud al destino", async () => {
    const destination = await startReceiver();
    const source = await startReceiver((_request, response) => {
      response.writeHead(307, { location: destination.url }).end();
    });
    await expect(waker.wake({ kind: "standard_webhook", url: source.url, secret }, notice))
      .resolves.toEqual({ ok: false, status: 307, retryable: false, ms: expect.any(Number) });
    expect(source.captured).toHaveLength(1);
    expect(destination.captured).toHaveLength(0);
  });

  it("no permite HTTP local con allowInsecure desactivado o en producción", async () => {
    const { url, captured } = await startReceiver();
    const target = { kind: "standard_webhook", url, secret } as const;
    const failure = { ok: false, retryable: false, detail: "https_required", ms: expect.any(Number) };
    await expect(createWaker({ allowInsecure: false }).wake(target, notice)).resolves.toEqual(failure);
    vi.stubEnv("NODE_ENV", "production");
    await expect(createWaker({ allowInsecure: true }).wake(target, notice)).resolves.toEqual(failure);
    expect(captured).toHaveLength(0);
  });
});

describe("verifyCallback", () => {
  it("verifica el challenge aleatorio y firma los bytes exactos", async () => {
    const { url, captured } = await startReceiver((request, response) => {
      response.end(JSON.stringify({ challenge: JSON.parse(request.body).challenge }));
    });
    vi.setSystemTime(fixedTime);
    await expect(waker.verifyCallback(mcpTarget(url + "/verify"))).resolves.toEqual({ ok: true });
    const request = expectRequest(captured, "/verify", {
      type: "verification", challenge: expect.stringMatching(/^[\w-]{24}$/),
    }, { "x-mcp-subscription-id": "sub_abcd" });
    const id = String(request.headers["webhook-id"]);
    expect(id).toMatch(/^msg_verification_[\w-]+$/);
    expectSignature(request, id, fixedTime.getTime() / 1000);
  });

  it("rechaza un challenge incorrecto de igual longitud", async () => {
    const { url } = await startReceiver((request, response) => {
      const challenge = String(JSON.parse(request.body).challenge);
      const wrongFirstChar = challenge[0] === "a" ? "b" : "a";
      response.end(JSON.stringify({ challenge: wrongFirstChar + challenge.slice(1) }));
    });
    await expect(waker.verifyCallback(mcpTarget(url)))
      .resolves.toEqual({ ok: false, reason: "challenge_failed" });
  });

  it("aplica el plazo de 10 s mientras llega el body", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let acknowledge!: () => void;
    const headersSent = new Promise<void>((resolve) => { acknowledge = resolve; });
    const { url } = await startReceiver((_request, response) => {
      response.writeHead(200).write('{"challenge":');
      acknowledge();
    });
    const result = waker.verifyCallback(mcpTarget(url));
    await headersSent;
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("rechaza un challenge cuya respuesta supera 64 KiB", async () => {
    const { url } = await startReceiver((request, response) => {
      response.end(JSON.stringify({ challenge: JSON.parse(request.body).challenge, extra: "a".repeat(64 * 1024) }));
    });
    await expect(waker.verifyCallback(mcpTarget(url))).resolves.toEqual({ ok: false, reason: "challenge_failed" });
  });

  it("devuelve el motivo de la política HTTPS/IP antes de conectar", async () => {
    await expect(waker.verifyCallback(mcpTarget("http://receiver.invalid")))
      .resolves.toEqual({ ok: false, reason: "https_required" });
    await expect(waker.verifyCallback(mcpTarget("https://127.0.0.1")))
      .resolves.toEqual({ ok: false, reason: "blocked_address" });
  });

  it("retiene exactamente hasta 64 KiB de respuesta", async () => {
    const body = "a".repeat(64 * 1024);
    const { url } = await startReceiver((_request, response) => response.end(body));
    await expect(createSafeFetch(true)({ url, body: "{}" }))
      .resolves.toEqual({ status: 200, body: Buffer.from(body) });
  });
});
