import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { after } from "next/server";
import { POST } from "./route";

vi.hoisted(() => vi.stubEnv("TELEMETRY_SINK", "off"));
vi.mock("next/server", () => ({ after: vi.fn() }));

const masterKey = randomBytes(32);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const notice = { event: "nexo.request.created", requestId: randomUUID() };

function signedRequest({ id = "bob", body = JSON.stringify(notice), eventId = "evt_" + notice.requestId,
  timestamp = Math.floor(Date.now() / 1000), host = "127.0.0.1:3002" } = {}) {
  const key = createHmac("sha256", masterKey).update("nexo/demo/contact-wake/v1/" + id).digest();
  const signature = createHmac("sha256", key).update(eventId + "." + timestamp + "." + body).digest("base64");
  return new Request("http://" + host + "/api/demo/contact-wake/" + id, {
    method: "POST", body, headers: {
      host, "webhook-signature": "v1," + signature, "webhook-id": eventId, "webhook-timestamp": String(timestamp),
    },
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("WEB_PORT", "3002");
  vi.stubEnv("WAKE_SECRETS_KEY", masterKey.toString("base64"));
});
afterEach(() => {
  expect(after).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("limita el receptor a desarrollo, al host local y a identificadores de titular válidos", async () => {
  expect((await POST(signedRequest({ host: "example.test:3002" }), params("bob"))).status).toBe(404);
  expect((await POST(signedRequest(), params("../ana"))).status).toBe(404);
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(signedRequest(), params("bob"))).status).toBe(404);
});

it("rechaza una firma de otro titular y una entrega vencida antes de buscar el perfil", async () => {
  expect((await POST(signedRequest({ id: "jane" }), params("bob"))).status).toBe(401);
  const stale = signedRequest({ timestamp: Math.floor(Date.now() / 1000) - 65 });
  expect((await POST(stale, params("bob"))).status).toBe(401);
});

it("limita los bytes del stream incluso cuando falta content-length", async () => {
  const oversized = signedRequest({ body: "á".repeat(1100) });
  expect(oversized.headers.has("content-length")).toBe(false);
  expect((await POST(oversized, params("bob"))).status).toBe(413);
});

it("vincula el aviso firmado al requestId y rechaza campos adicionales", async () => {
  const mismatch = signedRequest({ eventId: "evt_" + randomUUID() });
  expect((await POST(mismatch, params("bob"))).status).toBe(400);
  const extra = signedRequest({ body: JSON.stringify({ ...notice, tool: "interest_check" }) });
  const rejected = await POST(extra, params("bob"));
  expect(rejected.status).toBe(400);
  expect(rejected.headers.get("X-Error-Id")).toBeTruthy();
});
