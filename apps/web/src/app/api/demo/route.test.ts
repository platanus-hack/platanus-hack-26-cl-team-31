import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runContactSession } from "@team-31/demo/contact-session";
import { createTelemetry, offSink } from "@team-31/telemetry";
import { GET, POST } from "./route";

vi.mock("@team-31/demo/contact-session", () => ({
  checkContactRuntime: vi.fn(),
  reportContactError: vi.fn(() => "demo-error-id"),
  runContactSession: vi.fn(),
}));

// The web telemetry singleton reads this holder: tests never write to a database or stdout.
(globalThis as unknown as { __nexoWebTelemetry: unknown }).__nexoWebTelemetry =
  createTelemetry({ service: "web", sink: offSink(), heartbeatMs: 0, lifecycle: false });

const origin = "http://localhost:3002";
function request(person: string, from = origin) {
  return new Request(origin + "/api/demo", {
    method: "POST", headers: { host: "localhost:3002", origin: from },
    body: JSON.stringify({ person, mode: "contacts", message: "¿A alguien le interesa la cerámica?" }),
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("WEB_PORT", "3002");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("permite consultar el runtime de Ana aunque los servicios del chat de fútbol estén apagados", async () => {
  const status = await GET(new Request(origin + "/api/demo?mode=contacts", { headers: { host: "localhost:3002" } }));
  expect(await status.json()).toEqual({ contacts: true });
  const result = { text: "Bob confirmó.", traces: [
    { tool: "interest_check", input: { contact: "bob@nexo.app" }, data: { requestId: "id", decision: "allow", result: { matches: true } } },
  ] };
  vi.mocked(runContactSession).mockResolvedValue(result);
  expect(await (await POST(request("ana"))).json()).toEqual(result);
  expect(runContactSession).toHaveBeenCalledWith("¿A alguien le interesa la cerámica?", expect.any(Object));
});

it("rechaza otra identidad y peticiones de otro origen antes de invocar a Ana", async () => {
  expect((await POST(request("eva"))).status).toBe(403);
  expect((await POST(request("ana", "https://example.org"))).status).toBe(403);
  expect(runContactSession).not.toHaveBeenCalled();
});
