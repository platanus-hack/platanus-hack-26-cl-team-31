import { createHmac } from "node:crypto";
import { after } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const { store, broker } = vi.hoisted(() => ({
  store: { claim: vi.fn(), detect: vi.fn(), whileLinked: vi.fn() },
  broker: { ask: vi.fn(), status: vi.fn(), activity: vi.fn() },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));
vi.mock("../../../../lib/whatsapp/runtime", () => ({ whatsappStore: () => store }));
vi.mock("../../../../lib/broker", () => ({ ownerClient: () => broker }));

const phone = "56955550123";
const secret = "kapso-demo-webhook-not-production";
const code = "a".repeat(32);
const requestId = "e9ca0fa6-fd8b-426b-9db6-9be9005126e6";
const send = vi.fn();
let linkedUser: string | undefined;

function inbound(text: string, { signature, numberId = "12345", from = phone }: {
  signature?: string; numberId?: string; from?: string;
} = {}) {
  const body = JSON.stringify({ phone_number_id: numberId, message: {
    type: "text", from, id: "wamid.demo", timestamp: String(Math.floor(Date.now() / 1000)),
    text: { body: text }, kapso: { direction: "inbound" },
  } });
  return new Request("https://nexo.test/api/kapso/webhook", { method: "POST", body, headers: {
    "X-Webhook-Event": "whatsapp.message.received",
    "X-Webhook-Signature": signature ?? createHmac("sha256", secret).update(body).digest("hex"),
  } });
}

beforeEach(() => {
  vi.stubEnv("KAPSO_API_KEY", "kapso-test-key");
  vi.stubEnv("KAPSO_WEBHOOK_SECRET", secret);
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", "12345");
  vi.stubEnv("KAPSO_WHATSAPP_NUMBER", "+15555550123");
  vi.stubEnv("BETTER_AUTH_URL", "https://nexo.test");
  vi.stubGlobal("fetch", send.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 }))));
  linkedUser = undefined;
  store.claim.mockResolvedValue(true);
  store.whileLinked.mockImplementation((_phone, _timestamp, callback) => callback(linkedUser));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("no procesa mensajes sin firma válida, de otro número, sin teléfono o ya recibidos", async () => {
  expect((await POST(inbound("hola", { signature: "0".repeat(64) }))).status).toBe(401);
  expect((await POST(inbound("hola", { numberId: "456" }))).status).toBe(204);
  expect((await POST(inbound("hola", { from: "" }))).status).toBe(204);
  expect(store.claim).not.toHaveBeenCalled();
  store.claim.mockResolvedValue(false);
  expect((await POST(inbound("hola"))).status).toBe(200);
  expect(store.claim).toHaveBeenCalledWith("12345", "wamid.demo");
  expect(after).not.toHaveBeenCalled();
});

it("detecta el remitente del código y pide confirmar en la web, sin llamar al broker", async () => {
  store.detect.mockResolvedValue("user-a");
  expect((await POST(inbound(`VINCULAR ${code}`))).status).toBe(200);
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(store.detect).toHaveBeenCalledWith(code, `+${phone}`);
  const body = JSON.parse(send.mock.calls[0]?.[1].body);
  expect(body).toMatchObject({ to: phone, text: { body: expect.stringContaining("confirmar") } });
  expect(JSON.stringify(body)).not.toContain(code);
  expect(broker.ask).not.toHaveBeenCalled();
});

it("crea y consulta como el titular vinculado; desvinculado no puede consultar", async () => {
  linkedUser = "user-a";
  broker.ask.mockResolvedValue({ requestId, to: "carla@nexo.app", tool: "question", decision: "pending", waitingFor: "owner" });
  broker.activity.mockResolvedValue([{ direction: "sent", requestId }]);
  broker.status.mockResolvedValue({ requestId, to: "carla@nexo.app", tool: "question", decision: "allow", result: { answer: "Sí, puedo." } });

  async function message(text: string) {
    expect((await POST(inbound(text))).status).toBe(200);
    await (vi.mocked(after).mock.calls.at(-1)?.[0] as () => Promise<void>)();
    return JSON.parse(send.mock.calls.at(-1)?.[1].body).text.body;
  }
  expect(await message("Pregunta a carla@nexo.app si puede jugar")).toContain(requestId);
  expect(broker.ask).toHaveBeenCalledWith({ userId: "user-a" }, {
    to: "carla@nexo.app", tool: "question", args: { text: "si puede jugar" },
  });
  expect(await message("¿ya respondió?")).toContain("Sí, puedo.");
  expect(broker.status).toHaveBeenCalledWith({ userId: "user-a" }, requestId);
  broker.status.mockResolvedValue({ requestId, to: "carla@nexo.app", tool: "connect", decision: "allow", result: { accepted: true } });
  expect(await message(`estado ${requestId}`)).toContain("Aceptó la solicitud de conexión.");
  linkedUser = undefined;
  expect(await message("estado")).toContain("Vincula tu WhatsApp");
  expect(broker.status).toHaveBeenCalledTimes(2);
});
