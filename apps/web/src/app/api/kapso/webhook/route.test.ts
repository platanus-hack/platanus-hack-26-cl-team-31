import { createHmac } from "node:crypto";
import { after } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const { store, broker, flow, runtime } = vi.hoisted(() => ({
  store: { claim: vi.fn(), detect: vi.fn(), whileLinked: vi.fn(), pending: vi.fn(), clearPending: vi.fn(), assignLinkId: vi.fn() },
  flow: { latestContinuation: vi.fn(), handleMessage: vi.fn() }, runtime: vi.fn(),
  broker: { directory: vi.fn(), queryVault: vi.fn(), searchPublicProfiles: vi.fn(), ask: vi.fn(), status: vi.fn(), activity: vi.fn(), contacts: vi.fn(), setChannel: vi.fn() },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));
vi.mock("../../../../lib/whatsapp/runtime", () => ({ whatsappStore: () => store, whatsappMessageRuntime: runtime }));
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
  store.whileLinked.mockImplementation((_phone, _timestamp, callback) => callback(linkedUser, linkedUser && "link-1"));
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
  expect(store.clearPending).toHaveBeenCalledWith("user-a", requestId);
});

it("reanuda el turno del vínculo verificado, delega al titular y mantiene la entrega por WhatsApp", async () => {
  linkedUser = "user-a";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  runtime.mockReturnValue(flow);
  const question = "¿A mi amiga Adolfo le interesa el café?";
  const to = "adolfo.villalobos@sideband.app";
  const input = { to, tool: "interest_check", args: { interest: "café" }, idempotencyKey: "turn-1", requireRelation: { kind: "contact", tag: "friend" } };
  const owner = { userId: linkedUser };
  flow.latestContinuation.mockResolvedValue("saved-turn");
  flow.handleMessage.mockImplementation(async (context, message) => {
    expect(message).toEqual({ text: question, continuationId: "saved-turn" });
    expect(context).toMatchObject({ userId: linkedUser, binding: "whatsapp:link-1", deliveryId: "wamid.demo" });
    await context.ops.contacts();
    expect(await context.ops.recentSent()).toEqual([{ requestId, to }]);
    return { kind: "requests", items: [await context.ops.ask(input)], unconfirmedCount: 0, continuationId: "next" };
  });
  broker.activity.mockResolvedValue([{ direction: "received" }, { direction: "sent", requestId, to }]);
  broker.ask.mockResolvedValue({ requestId, to, tool: "interest_check", decision: "pending", waitingFor: "agent" });
  expect((await POST(inbound(question))).status).toBe(200);
  expect(after).not.toHaveBeenCalled();
  expect(flow.latestContinuation).toHaveBeenCalledWith(linkedUser, "whatsapp:link-1", "clarify");
  expect(broker.directory).toHaveBeenCalledWith(owner);
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith(owner, input, "whatsapp");
  expect(JSON.parse(send.mock.calls.at(-1)?.[1].body).text.body).toBe(`Le pregunté a ${to}. Te aviso apenas responda.`);
});

it("reintenta un lote pendiente solo al recibir continuar", async () => {
  linkedUser = "user-a";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  runtime.mockReturnValue(flow);
  flow.latestContinuation.mockResolvedValue("partial");
  flow.handleMessage.mockResolvedValue({ kind: "requests", unconfirmedCount: 2, items: [], continuationId: "partial" });
  await POST(inbound("continuar"));
  expect(after).not.toHaveBeenCalled();
  expect(flow.latestContinuation).toHaveBeenCalledWith(linkedUser, "whatsapp:link-1", "dispatch");
  expect(flow.handleMessage).toHaveBeenCalledWith(expect.anything(), { text: "continuar", continuationId: "partial" });
  expect(JSON.parse(send.mock.calls.at(-1)?.[1].body).text.body).toContain("2 envíos");
});

it("entrega una lista de perfiles grande sin truncar nombres en el límite de WhatsApp", async () => {
  linkedUser = "user-a";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  runtime.mockReturnValue(flow);
  const profiles = Array.from({ length: 100 }, (_, i) => ({
    displayName: `Persona ${i}`, address: `persona${i}@sideband.app`, headline: "Taller de cerámica",
  }));
  flow.handleMessage.mockResolvedValue({ kind: "profiles", items: profiles });
  expect((await POST(inbound("Busca perfiles públicos del taller"))).status).toBe(200);
  const parts = send.mock.calls.map(([, init]) => JSON.parse(init.body).text.body as string);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every(part => part.length <= 4096)).toBe(true);
  expect(parts.join("")).toBe(profiles.map(p => `${p.displayName} (${p.address}) — ${p.headline}`).join("\n"));
});

it("no comparte con Claude los mensajes de números sin vínculo", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  expect((await POST(inbound("¿Simón puede juntarse ahora?"))).status).toBe(200);
  expect(after).not.toHaveBeenCalled();
  expect(runtime).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledOnce();
  expect(String(send.mock.calls[0]?.[0])).toContain("api.kapso.ai");
  expect(broker.contacts).not.toHaveBeenCalled();
  expect(broker.ask).not.toHaveBeenCalled();
});

it("deja reintentable un error del proveedor sin acusar recibo antes de terminar", async () => {
  linkedUser = "user-a";
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  runtime.mockReturnValue(flow);
  flow.handleMessage.mockRejectedValueOnce(new Error("temporarily unavailable"));
  const response = await POST(inbound("¿A mi amiga le gusta la cerámica?"));
  expect(response.status).toBe(503);
  expect(response.headers.get("X-Error-Id")).toBeTruthy();
  expect(store.whileLinked.mock.calls[0]?.[3]).toEqual({ numberId: "12345", messageId: "wamid.demo" });
  expect(store.claim).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

it("registra el canal de un vínculo anterior a los avisos con el primer mensaje", async () => {
  linkedUser = "user-a";
  vi.stubEnv("WHATSAPP_NOTICE_SECRET", "whsec_dGVzdC1ub3RpY2Utc2VjcmV0LW5vdC1wcm9kdWN0aW9u");
  const linkId = "0b6f3c1e-8d2a-4f6b-9c1d-2e3f4a5b6c7d";
  store.assignLinkId.mockResolvedValueOnce({ userId: "user-a", linkId });
  broker.contacts.mockResolvedValue({ contacts: [] });
  await POST(inbound("contactos"));
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(store.assignLinkId).toHaveBeenCalledWith(`+${phone}`);
  expect(broker.setChannel).toHaveBeenCalledExactlyOnceWith({ userId: "user-a" }, "whatsapp", {
    kind: "standard_webhook", url: `https://sideband.test/api/whatsapp/notice/${linkId}`,
    secret: "whsec_dGVzdC1ub3RpY2Utc2VjcmV0LW5vdC1wcm9kdWN0aW9u",
  });

  vi.mocked(after).mockClear();
  await POST(inbound("contactos"));
  await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
  expect(broker.setChannel).toHaveBeenCalledOnce();
});
