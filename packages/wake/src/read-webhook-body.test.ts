import { describe, expect, it, vi } from "vitest";
import { readWebhookBody } from "./read-webhook-body.js";

function chunkedRequest(chunks: Uint8Array[], cancel?: () => void) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  return new Request("https://example.test/webhook", { method: "POST", body, duplex: "half" });
}

describe("readWebhookBody", () => {
  it("conserva los bytes en orden cuando el cuerpo alcanza el límite exacto", async () => {
    const request = chunkedRequest([Uint8Array.of(0, 255), Uint8Array.of(), Uint8Array.of(128)]);
    await expect(readWebhookBody(request, 3)).resolves.toEqual(Buffer.from([0, 255, 128]));
  });

  it("devuelve null y cancela lo pendiente si la suma de fragmentos supera el límite", async () => {
    const cancel = vi.fn();
    const request = chunkedRequest([Uint8Array.of(1, 2), Uint8Array.of(3, 4), Uint8Array.of(5)], cancel);
    await expect(readWebhookBody(request, 3)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("acepta una solicitud sin cuerpo con límite cero", async () => {
    const request = new Request("https://example.test/webhook", { method: "POST" });
    await expect(readWebhookBody(request, 0)).resolves.toEqual(Buffer.alloc(0));
  });
});
