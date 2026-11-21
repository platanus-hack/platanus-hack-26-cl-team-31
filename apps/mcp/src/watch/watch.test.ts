import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createBroker, createMemoryStore } from "@team-31/broker";
import { createWaker } from "@team-31/wake";
import { expect, it, vi } from "vitest";
import { createHttpServer } from "../http.js";
import { startReceiver } from "./listener.js";
import { openCodeNotifier } from "./opencode.js";
import { pollInbox } from "./poll.js";
import { connect } from "./remote.js";

it("se suscribe por MCP, recibe un aviso firmado del broker, omite duplicados y se desuscribe", async () => {
  const sender = { userId: "alice" };
  const owner = { userId: "bruno" };
  const watcher = { ...owner, agentId: "watcher", scopes: ["sideband:inbox"] as const };
  const waker = createWaker({ allowInsecure: true });
  const verifyCallback = vi.spyOn(waker, "verifyCallback").mockResolvedValueOnce({ ok: false, reason: "challenge_failed" });
  const sendWake = vi.spyOn(waker, "wake");
  const broker = createBroker({
    store: createMemoryStore(),
    waker,
    clock: { now: () => new Date() },
    signingKey: generateKeyPairSync("ed25519").privateKey,
    nonceKey: randomBytes(32),
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0], addressDomain: "sideband.app" },
  });
  const request = { to: "bruno@sideband.app", tool: "question", args: { text: "¿Recibido?", category: "general" } } as const;
  await broker.owner.claimAddress(sender, "alice");
  await broker.owner.claimAddress(owner, "bruno");
  await broker.owner.setGrant(owner, { grantee: "alice@sideband.app", category: "general" });

  const events: string[] = [];
  const receiver = await startReceiver((id) => events.push(id));
  const callback = new URL(receiver.path, receiver.origin);
  const server = createHttpServer({
    devAuth: true, audience: "https://mcp.example.test/mcp", issuer: "https://auth.example.test",
    jwksUrl: "https://auth.example.test/jwks",
  }, broker.agent);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("El MCP no abrió un puerto");
  let remote: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    remote = await connect(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer dev:bruno:watcher" } },
    });
    expect(await remote.supportsWebhook()).toBe(true);
    const { id } = await remote.subscribe(callback, receiver.secret);
    expect(verifyCallback).toHaveBeenCalledTimes(2);
    expect(verifyCallback.mock.calls[0]?.[0]).toMatchObject({ subscriptionId: id, callbackUrl: callback.href });
    expect(verifyCallback.mock.calls[1]?.[0]).toMatchObject({ subscriptionId: id, callbackUrl: callback.href });
    expect((await fetch(callback, {
      method: "POST",
      headers: {
        "x-mcp-subscription-id": id,
        "webhook-signature": "v1,invalid",
        "webhook-id": "msg_test",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ type: "verification", challenge: "fake" }),
    })).status).toBe(401);

    const { requestId } = await broker.owner.ask(sender, request);
    expect((await broker.tick(new Date())).wakesOk).toBe(1);
    expect(events).toEqual([requestId]);
    expect((await broker.agent.inbox({ ...watcher, scopes: [...watcher.scopes] })).map((item) => item.requestId)).toContain(requestId);
    expect(await remote.inbox(AbortSignal.timeout(3_000))).toEqual([requestId]);
    const [target, notice] = sendWake.mock.calls[0]!;
    expect((await waker.wake(target, notice)).status).toBe(204);
    expect(events).toEqual([requestId]);

    await remote.unsubscribe(id);
    expect((await broker.owner.agents(owner))[0]).toMatchObject({ wakeKind: "none" });
    verifyCallback.mockResolvedValueOnce({ ok: false, reason: "blocked_address" });
    await expect(remote.subscribe(callback, receiver.secret)).rejects.toMatchObject({
      code: -32015, data: { reason: "blocked_address" },
    });
    expect(verifyCallback).toHaveBeenCalledTimes(3);
    await broker.owner.ask(sender, request);
    await broker.tick(new Date());
    expect(events).toEqual([requestId]);
  } finally {
    await remote?.close();
    await receiver.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

it("avisa solo por solicitudes nuevas y retoma la lectura después de un error", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const onReady = vi.fn();
  const onRetry = vi.fn();
  const inbox = vi.fn<() => Promise<string[]>>()
    .mockResolvedValueOnce(["previa"])
    .mockRejectedValueOnce(new Error("sin conexión"))
    .mockResolvedValueOnce(["previa", "nueva"])
    .mockResolvedValueOnce(["nueva", "otra"]);
  await pollInbox({
    inbox, signal: controller.signal, intervalMs: 1, onReady, onRetry,
    onRequest(id) {
      events.push(id);
      if (id === "otra") controller.abort();
    },
  });
  expect(events).toEqual(["nueva", "otra"]);
  expect(onReady).toHaveBeenCalledOnce();
  expect(onRetry).toHaveBeenCalledOnce();
});

it("valida la sesión e inyecta solo el ID en un aviso en cola de OpenCode", async () => {
  const session = "ses_test";
  const signal = new AbortController().signal;
  const call = vi.fn<(args: string[], signal: AbortSignal) => Promise<unknown>>()
    .mockResolvedValueOnce({ data: { id: session } })
    .mockResolvedValueOnce({ data: { sessionID: session, type: "synthetic" } });
  const notify = await openCodeNotifier(session, signal, call);
  await expect(notify("contenido inesperado")).rejects.toThrow();
  const requestId = "11111111-1111-4111-8111-111111111111";
  await notify(requestId);
  expect(call).toHaveBeenCalledTimes(2);
  expect(call).toHaveBeenNthCalledWith(1, ["get", `/api/session/${session}`], signal);
  const [args] = call.mock.calls[1]!;
  expect(args.slice(0, 3)).toEqual(["post", `/api/session/${session}/synthetic`, "--data"]);
  expect(JSON.parse(args[3]!)).toMatchObject({
    text: expect.stringContaining(requestId), metadata: { source: "sideband", requestId },
    delivery: "queue", resume: true,
  });
});
