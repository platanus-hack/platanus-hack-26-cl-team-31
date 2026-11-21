import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSafeFetch } from "./safe-fetch.js";

const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: httpsRequest }));

afterEach(() => {
  vi.useRealTimers();
  httpsRequest.mockReset();
});

describe("safeFetch", () => {
  it("exige HTTPS incluso con la excepción local habilitada para otras direcciones", async () => {
    const resolve = vi.fn(async () => ["10.0.0.1"]);
    const safeFetch = createSafeFetch(true, resolve);
    await expect(safeFetch({ url: "http://169.254.169.254", body: "{}" }))
      .resolves.toEqual({ failure: "https_required" });
    await expect(safeFetch({ url: "http://receiver.invalid", body: "{}" }))
      .resolves.toEqual({ failure: "https_required" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("bloquea un dominio con una dirección privada en la respuesta DNS", async () => {
    const resolve = vi.fn(async () => ["10.0.0.1"]);
    const safeFetch = createSafeFetch(false, resolve);
    await expect(safeFetch({ url: "https://receiver.invalid", body: "{}" }))
      .resolves.toEqual({ failure: "blocked_address" });
    expect(resolve).toHaveBeenCalledExactlyOnceWith("receiver.invalid", expect.any(AbortSignal));
  });

  it("valida cada respuesta DNS antes de conectar", async () => {
    const safeFetch = createSafeFetch(false, async () => ["2001:4860::1", "fc00::1"]);
    await expect(safeFetch({ url: "https://receiver.invalid", body: "{}" }))
      .resolves.toEqual({ failure: "blocked_address" });
  });

  it.each([
    "https://127.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://[::1]",
    "https://[fe80::1]",
    "https://[::ffff:127.0.0.1]",
  ])("bloquea %s antes de conectar", async (url) => {
    const safeFetch = createSafeFetch(true);
    await expect(safeFetch({ url, body: "{}" })).resolves.toEqual({ failure: "blocked_address" });
  });

  it("conecta a la IP validada con Host, SNI y verificación TLS del destino original", async () => {
    const resolve = vi.fn(async () => ["2001:4860::1"]);
    const safeFetch = createSafeFetch(false, resolve);
    httpsRequest.mockImplementation((_options, onResponse: (response: PassThrough) => void) => {
      const request = new EventEmitter();
      return Object.assign(request, {
        end() {
          const response = Object.assign(new PassThrough(), { statusCode: 204 });
          onResponse(response);
          response.end();
        },
      });
    });

    const url = "https://receiver.invalid:8443/events";
    await expect(safeFetch({ url, body: "{}" })).resolves.toEqual({ status: 204, body: Buffer.alloc(0) });
    expect(resolve).toHaveBeenCalledOnce();
    expect(httpsRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      hostname: "2001:4860::1",
      port: "8443",
      servername: "receiver.invalid",
      agent: false,
      rejectUnauthorized: true,
      headers: expect.objectContaining({ host: "receiver.invalid:8443" }),
    }), expect.any(Function));
  });

  it("cancela la resolución DNS al cumplirse el plazo", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    const safeFetch = createSafeFetch(false, (_hostname, signal) => {
      signal.addEventListener("abort", abort);
      return new Promise(() => {});
    });
    const result = safeFetch({ url: "https://receiver.invalid", body: "{}" });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toEqual({ failure: "timeout" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("clasifica los errores del resolver sin detalles externos", async () => {
    const safeFetch = createSafeFetch(false, async () => {
      throw new Error("mensaje externo");
    });
    await expect(safeFetch({ url: "https://receiver.invalid", body: "{}" }))
      .resolves.toEqual({ failure: "network_error" });
  });
});
