import { createHmac } from "node:crypto";
import { after } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const { store, broker } = vi.hoisted(() => ({
  store: { whileNotified: vi.fn(), claim: vi.fn(), addPending: vi.fn() },
  broker: { status: vi.fn() },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));
vi.mock("../../../../../lib/whatsapp/runtime", () => ({ whatsappStore: () => store }));
vi.mock("../../../../../lib/broker", () => ({ ownerClient: () => broker }));

const secret = `whsec_${Buffer.from("n".repeat(32)).toString("base64")}`;
const linkId = "2f0c8a5e-6c1d-4f0b-9a52-0c9a1f3d7b11";
const requestId = "e9ca0fa6-fd8b-426b-9db6-9be9005126e6";
const phone = "+56955550123";
const send = vi.fn();
const answered = { requestId, to: "carla@sideband.app", tool: "question", final: true, decision: "allow", result: { answer: "Sí, el sábado puedo." } };

function notice({ event = "sideband.request.updated", key = secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify({ requestId, event });
  const id = `evt_${requestId}`;
  const signature = createHmac("sha256", Buffer.from(key.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${body}`).digest("base64");
  return POST(new Request(`https://sideband.test/api/whatsapp/notice/${linkId}`, { method: "POST", body, headers: {
    "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}`,
  } }), { params: Promise.resolve({ id: linkId }) });
}

async function deliver(link: { windowOpen: boolean } | undefined) {
  store.whileNotified.mockImplementation((_id, run) => run(link && { userId: "user-a", phone, ...link }));
  expect((await notice()).status).toBe(200);
  await (vi.mocked(after).mock.calls.at(-1)?.[0] as () => Promise<void>)();
}

const sentTexts = () => send.mock.calls.map(([, init]) => JSON.parse(init.body).text.body);

beforeEach(() => {
  vi.stubEnv("KAPSO_API_KEY", "kapso-test-key");
  vi.stubEnv("KAPSO_WEBHOOK_SECRET", "kapso-demo-webhook-not-production");
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", "12345");
  vi.stubEnv("KAPSO_WHATSAPP_NUMBER", "+15555550123");
  vi.stubEnv("BETTER_AUTH_URL", "https://sideband.test");
  vi.stubEnv("WHATSAPP_NOTICE_SECRET", secret);
  vi.stubGlobal("fetch", send.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 }))));
  broker.status.mockResolvedValue(answered);
  store.claim.mockResolvedValue(true);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("rechaza avisos sin firma válida, vencidos o de otro evento, y no existe sin secreto", async () => {
  expect((await notice({ key: `whsec_${Buffer.from("x".repeat(32)).toString("base64")}` })).status).toBe(401);
  expect((await notice({ timestamp: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
  expect((await notice({ event: "sideband.request.created" })).status).toBe(400);
  expect(after).not.toHaveBeenCalled();
  vi.stubEnv("WHATSAPP_NOTICE_SECRET", undefined);
  expect((await notice()).status).toBe(404);
});

it("envía la respuesta final una sola vez aunque el broker repita el aviso", async () => {
  await deliver({ windowOpen: true });
  expect(broker.status).toHaveBeenCalledWith({ userId: "user-a" }, requestId);
  expect(store.claim).toHaveBeenCalledWith("notice", `${requestId}:final`);
  expect(sentTexts()).toEqual([expect.stringContaining("Sí, el sábado puedo.")]);
  expect(send.mock.calls[0]?.[1].body).toContain(phone.slice(1));
  store.claim.mockResolvedValue(false);
  await deliver({ windowOpen: true });
  expect(send).toHaveBeenCalledOnce();
});

it("avisa que espera la aprobación del destinatario y calla mientras espera a su agente", async () => {
  broker.status.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "question", final: false, decision: "pending", waitingFor: "owner" });
  await deliver({ windowOpen: true });
  expect(store.claim).toHaveBeenCalledWith("notice", `${requestId}:owner`);
  expect(sentTexts()).toEqual(["Esperando a que carla@sideband.app apruebe tu pregunta."]);
  broker.status.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "question", final: false, decision: "pending", waitingFor: "agent" });
  await deliver({ windowOpen: true });
  expect(send).toHaveBeenCalledOnce();
});

it("guarda la entrega si pasaron 24 horas y descarta avisos de vínculos que ya no existen", async () => {
  await deliver({ windowOpen: false });
  expect(store.addPending).toHaveBeenCalledWith("user-a", requestId);
  expect(send).not.toHaveBeenCalled();
  await deliver(undefined);
  expect(broker.status).toHaveBeenCalledOnce();
});
