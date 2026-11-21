import { createHmac } from "node:crypto";
import { after } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const { store, broker } = vi.hoisted(() => ({
  store: { claim: vi.fn(), detect: vi.fn(), whileLinked: vi.fn(), pending: vi.fn(), deliverPending: vi.fn(), registerChannel: vi.fn() },
  broker: { ask: vi.fn(), status: vi.fn(), activity: vi.fn(), contacts: vi.fn(), setChannel: vi.fn() },
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
  return new Request("https://sideband.test/api/kapso/webhook", { method: "POST", body, headers: {
    "X-Webhook-Event": "whatsapp.message.received",
    "X-Webhook-Signature": signature ?? createHmac("sha256", secret).update(body).digest("hex"),
  } });
}

beforeEach(() => {
  vi.stubEnv("KAPSO_API_KEY", "kapso-test-key");
  vi.stubEnv("KAPSO_WEBHOOK_SECRET", secret);
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", "12345");
  vi.stubEnv("KAPSO_WHATSAPP_NUMBER", "+15555550123");
  vi.stubEnv("BETTER_AUTH_URL", "https://sideband.test");
  vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  // A local .env.local may point the SDK at a proxy; these tests intercept the public API.
  vi.stubEnv("ANTHROPIC_BASE_URL", undefined);
  vi.stubGlobal("fetch", send.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 }))));
  linkedUser = undefined;
  store.claim.mockResolvedValue(true);
  store.pending.mockResolvedValue([]);
  store.deliverPending.mockImplementation((_phone, _timestamp, _id, deliver) => deliver(linkedUser));
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
  broker.ask.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "question", decision: "pending", waitingFor: "owner" });
  broker.activity.mockResolvedValue([{ direction: "sent", requestId }]);
  broker.status.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "question", decision: "allow", result: { answer: "Sí, puedo." } });

  async function message(text: string) {
    expect((await POST(inbound(text))).status).toBe(200);
    await (vi.mocked(after).mock.calls.at(-1)?.[0] as () => Promise<void>)();
    return JSON.parse(send.mock.calls.at(-1)?.[1].body).text.body;
  }
  expect(await message("Pregunta a carla@sideband.app si puede jugar"))
    .toBe("Le pregunté a carla@sideband.app. Espera su aprobación; te aviso apenas responda.");
  expect(broker.ask).toHaveBeenCalledWith({ userId: "user-a" }, {
    to: "carla@sideband.app", tool: "question", args: { text: "si puede jugar", category: "general" },
  }, "whatsapp");
  expect(await message("¿ya respondió?")).toContain("Sí, puedo.");
  expect(broker.status).toHaveBeenCalledWith({ userId: "user-a" }, requestId);
  broker.status.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "connect", decision: "allow", result: { accepted: true } });
  expect(await message(`estado ${requestId}`)).toContain("Aceptó la solicitud de conexión.");
  linkedUser = undefined;
  expect(await message("estado")).toContain("Vincula tu WhatsApp");
  expect(broker.status).toHaveBeenCalledTimes(2);
});

it("envía primero las respuestas que quedaron fuera de la ventana de 24 horas", async () => {
  linkedUser = "user-a";
  store.pending.mockResolvedValue([requestId]);
  broker.status.mockResolvedValue({ requestId, to: "carla@sideband.app", tool: "question", final: true, decision: "allow", result: { answer: "Sí, puedo." } });
  expect((await POST(inbound("contactos"))).status).toBe(200);
  broker.contacts.mockResolvedValue({ contacts: [] });
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  const texts = send.mock.calls.map(([, init]) => JSON.parse(init.body).text.body);
  expect(texts).toEqual([expect.stringContaining("Sí, puedo."), expect.stringContaining("Aún no tienes contactos")]);
  expect(store.deliverPending).toHaveBeenCalledWith(`+${phone}`, expect.any(Number), requestId, expect.any(Function));
});

it("interpreta texto libre con Claude sin enviarle contactos ni entregar una pregunta inventada", async () => {
  linkedUser = "user-a";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  const question = "¿Adolfo tiene disponibilidad para un café hoy?";
  const to = "adolfo.villalobos@sideband.app";
  broker.contacts.mockResolvedValue({ contacts: [{ address: to }] });
  broker.ask.mockResolvedValue({ requestId, to, tool: "question", decision: "pending", waitingFor: "agent" });
  send.mockImplementation((url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      const payload = JSON.parse(init.body);
      expect(payload.messages).toEqual([{ role: "user", content: question }]);
      expect(init.body).not.toContain(to);
      return Promise.resolve(Response.json({
        type: "message", role: "assistant", stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ action: "ask", recipient: "Adolfo", category: "availability" }) }],
      }));
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });

  expect((await POST(inbound(question))).status).toBe(200);
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(broker.contacts).toHaveBeenCalledWith({ userId: "user-a" });
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith({ userId: "user-a" }, { to, tool: "question", args: { text: question, category: "availability" } }, "whatsapp");
  expect(JSON.parse(send.mock.calls.at(-1)?.[1].body).text.body).toBe(`Le pregunté a ${to}. Te aviso apenas responda.`);
});

it("no comparte con Claude los mensajes de números sin vínculo", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  expect((await POST(inbound("¿Simón puede juntarse ahora?"))).status).toBe(200);
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(send).toHaveBeenCalledOnce();
  expect(String(send.mock.calls[0]?.[0])).toContain("api.kapso.ai");
  expect(broker.contacts).not.toHaveBeenCalled();
  expect(broker.ask).not.toHaveBeenCalled();
});

it("registra el canal de un vínculo anterior a los avisos con el primer mensaje", async () => {
  linkedUser = "user-a";
  vi.stubEnv("WHATSAPP_NOTICE_SECRET", "whsec_dGVzdC1ub3RpY2Utc2VjcmV0LW5vdC1wcm9kdWN0aW9u");
  const linkId = "0b6f3c1e-8d2a-4f6b-9c1d-2e3f4a5b6c7d";
  store.registerChannel.mockImplementationOnce((_link, register) => register("user-a", linkId));
  broker.contacts.mockResolvedValue({ contacts: [] });
  await POST(inbound("contactos"));
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(store.registerChannel).toHaveBeenCalledWith({ phone: `+${phone}`, timestamp: expect.any(Number) }, expect.any(Function));
  expect(broker.setChannel).toHaveBeenCalledExactlyOnceWith({ userId: "user-a" }, "whatsapp", {
    kind: "standard_webhook", url: `https://sideband.test/api/whatsapp/notice/${linkId}`,
    secret: "whsec_dGVzdC1ub3RpY2Utc2VjcmV0LW5vdC1wcm9kdWN0aW9u",
  });

  vi.mocked(after).mockClear();
  await POST(inbound("contactos"));
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(broker.setChannel).toHaveBeenCalledOnce();
});


it.each(["status", "send", "list"])("procesa el comando aunque falle una entrega pendiente (%s)", async (failure) => {
  linkedUser = "user-a";
  store.pending.mockResolvedValue([requestId]);
  broker.contacts.mockResolvedValue({ contacts: [] });
  if (failure === "list") store.pending.mockRejectedValue(new Error("offline"));
  if (failure === "status") broker.status.mockRejectedValue(new Error("offline"));
  if (failure === "send") {
    broker.status.mockResolvedValue({ requestId, tool: "question", decision: "allow", result: { answer: "Sí" } });
    send.mockResolvedValueOnce(new Response(null, { status: 503 }));
  }
  await POST(inbound("contactos"));
  await (vi.mocked(after).mock.calls[0]![0] as () => Promise<void>)();
  expect(broker.contacts).toHaveBeenCalledExactlyOnceWith({ userId: linkedUser });
  expect(JSON.parse(send.mock.calls.at(-1)![1].body).text.body).toContain("Aún no tienes contactos");
});

it("keeps channel registration retryable after a broker failure", async () => {
  linkedUser = "user-a";
  vi.stubEnv("WHATSAPP_NOTICE_SECRET", "whsec_test");
  const linkId = "0b6f3c1e-8d2a-4f6b-9c1d-2e3f4a5b6c7d";
  const outcomes: boolean[] = [];
  store.registerChannel.mockImplementation(async (_link, register) => {
    outcomes.push(await register(linkedUser, linkId));
  });
  broker.setChannel.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  broker.contacts.mockResolvedValue({ contacts: [] });
  for (let i = 0; i < 2; i++) {
    await POST(inbound("contactos"));
    await (vi.mocked(after).mock.calls.at(-1)![0] as () => Promise<void>)();
  }
  expect(outcomes).toEqual([false, true]);
  expect(broker.setChannel.mock.calls[1]).toEqual(broker.setChannel.mock.calls[0]);
  expect(broker.contacts).toHaveBeenCalledTimes(2);
});
