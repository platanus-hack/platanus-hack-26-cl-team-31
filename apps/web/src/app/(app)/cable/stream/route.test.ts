import { afterEach, describe, expect, it, vi } from "vitest";

import { getSession } from "../../../../lib/auth";
import { getServiceToken } from "../../../../lib/broker";
import { GET } from "./route";

vi.mock("../../../../lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("../../../../lib/broker", () => ({
  brokerUrl: () => "https://broker.example.test",
  getServiceToken: vi.fn(),
}));

const activity = {
  requestId: "request-123",
  from: "ana@nexo.app",
  to: "bob@nexo.app",
  tool: "question",
  status: "no_data",
  createdAt: "2026-11-21T12:00:00Z",
  expiresAt: "2026-11-21T12:15:00Z",
  events: [{ kind: "permission", at: "2026-11-21T12:00:00Z", internalReason: "Motivo anidado privado" }],
  droppedFields: ["answer"],
  decisionReason: "Revisión privada del dueño",
  internalReason: "Sin información en el calendario",
};

const versionId = "Z".repeat(43);
const streamUrl = "https://web.example.test/cable/stream";

function session(userId: string) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: userId } } as NonNullable<Awaited<ReturnType<typeof getSession>>>);
  vi.mocked(getServiceToken).mockResolvedValue("server-jwt");
}

function frames(...chunks: string[]) {
  const encoded = new TextEncoder().encode(chunks.join(""));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += 7) {
        controller.enqueue(encoded.subarray(offset, offset + 7));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "X-Internal-Token": "server-jwt" },
  });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /cable/stream", () => {
  it("rejects unauthenticated requests before minting a token or opening the broker stream", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await GET(new Request(streamUrl))).status).toBe(401);
    expect(getServiceToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes private reasons from outgoing activity and preserves safe SSE frames", async () => {
    session("ana");
    const fetch = vi.fn().mockResolvedValue(frames(
      "retry: 1000\r\n\r\n",
      "event: unknown\ndata: Motivo fuera del esquema\n\n",
      "event: activity\ndata: {json inválido}\n\n",
      "event: activity\ndata: {\"direction\":\"sent\"}\n\n",
      `id: ${versionId}\r\nevent: activity\r\ndata: ${JSON.stringify({ ...activity, direction: "sent" })}\r\n\r\n`,
      ": Motivo privado en comentario\n\n",
    ));
    vi.stubGlobal("fetch", fetch);

    const request = new Request(`${streamUrl}?userId=bob`, { headers: { Authorization: "Bearer browser-token" } });
    const response = await GET(request);
    expect(getServiceToken).toHaveBeenCalledWith({ userId: "ana" });
    expect(fetch).toHaveBeenCalledWith(new URL("https://broker.example.test/v1/owner/stream"), {
      headers: { Accept: "text/event-stream", Authorization: "Bearer server-jwt" },
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.has("X-Internal-Token")).toBe(false);

    const body = await response.text();
    const { decisionReason, internalReason, ...publicActivity } = activity;
    expect(body).not.toContain(decisionReason);
    expect(body).not.toContain(internalReason);
    expect(body).not.toContain("server-jwt");
    expect(body).toBe(
      `retry: 1000\n\nevent: activity\nid: ${versionId}\ndata: ${JSON.stringify({
        ...publicActivity,
        events: [{ kind: "permission", at: activity.createdAt }],
        direction: "sent",
      })}\n\n: heartbeat\n\n`,
    );
  });

  it("preserves private reasons for the receiving owner", async () => {
    session("bob");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(frames(
      'event: activity\ndata: {\n',
      `data: ${JSON.stringify({ ...activity, direction: "received" }).slice(1)}\n\n`,
    )));

    const response = await GET(new Request(streamUrl));
    const body = await response.text();
    const data = body.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "";
    expect(JSON.parse(data)).toMatchObject({
      direction: "received",
      decisionReason: activity.decisionReason,
      internalReason: activity.internalReason,
    });
  });

  it("cancels upstream when the browser aborts the request", async () => {
    session("ana");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    })));
    const controller = new AbortController();
    const response = await GET(new Request(streamUrl, { signal: controller.signal }));
    const pending = response.body?.getReader().read();

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
