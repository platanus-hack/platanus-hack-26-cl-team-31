import { createTelemetry, memorySink } from "@team-31/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStreamSession } from "../../../../lib/auth";
import { signServiceToken } from "../../../../lib/broker";
import { GET } from "./route";

vi.mock("../../../../lib/auth", () => ({ getStreamSession: vi.fn() }));
vi.mock("../../../../lib/broker", () => ({
  brokerUrl: () => "https://broker.example.test",
  brokerFetch: () => (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  signServiceToken: vi.fn(),
}));

// The web singleton (lib/telemetry) reads this holder: tests write to memory, never to a database.
const sink = memorySink();
(globalThis as unknown as { __sidebandWebTelemetry: unknown }).__sidebandWebTelemetry =
  createTelemetry({ service: "web", sink, heartbeatMs: 0, lifecycle: false });

const activity = {
  requestId: "request-123",
  from: "ana@sideband.app",
  to: "bob@sideband.app",
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
  vi.mocked(getStreamSession).mockResolvedValue({ user: { id: userId }, session: { id: "s1" } } as NonNullable<Awaited<ReturnType<typeof getStreamSession>>>);
  vi.mocked(signServiceToken).mockResolvedValue("server-jwt");
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
  sink.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /cable/stream", () => {
  it("rejects unauthenticated requests before minting a token or opening the broker stream", async () => {
    vi.mocked(getStreamSession).mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect((await GET(new Request(streamUrl))).status).toBe(401);
    expect(signServiceToken).not.toHaveBeenCalled();
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
    expect(signServiceToken).toHaveBeenCalledWith({ userId: "ana" });
    expect(fetch).toHaveBeenCalledWith(new URL("https://broker.example.test/v1/owner/stream"), {
      headers: { Accept: "text/event-stream", Authorization: "Bearer server-jwt" },
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.has("X-Internal-Token")).toBe(false);
    expect(sink.find("http.request")).toEqual([expect.objectContaining({
      service: "web", userId: "ana", attrs: { method: "GET", route: "/cable/stream", status: 200, bucket: "2xx" },
    })]);

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

  it("ends the open stream without forwarding new activity after sign-out", async () => {
    session("bob");
    let send!: (chunk: Uint8Array) => void;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { send = (chunk) => c.enqueue(chunk); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
    const response = await GET(new Request(streamUrl));
    vi.mocked(getStreamSession).mockResolvedValue(null);
    send(new TextEncoder().encode(`event: activity\ndata: ${JSON.stringify({ ...activity, direction: "received" })}\n\n`));
    expect(await response.text()).toBe("");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(sink.find("auth.token.rejected")[0]?.attrs.reason).toBe("access_ended");
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

  it("reports a broker failure with X-Error-Id and without its message", async () => {
    session("ana");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("detalle privado del broker")));
    const response = await GET(new Request(streamUrl));
    expect(response.status).toBe(502);
    const [error] = sink.find("error");
    expect(error).toMatchObject({ userId: "ana", attrs: expect.objectContaining({ operation: "GET /cable/stream" }) });
    expect(response.headers.get("X-Error-Id")).toBe(error?.errorId);
    expect(JSON.stringify(sink.records)).not.toContain("detalle privado");
  });
});
