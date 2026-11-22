import { createTelemetry, memorySink } from "@team-31/telemetry";
import { afterEach, expect, it, vi } from "vitest";

import { POST } from "./route";

const handler = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ handler, api: { getSession: async () => ({ user: { id: "ana" } }) } }),
}));

afterEach(() => vi.unstubAllGlobals());

it.each([
  { status: 200, events: 1 },
  { status: 400, events: 0 },
])("registra $events decisiones de consentimiento cuando Better Auth responde $status", async ({ status, events }) => {
  const sink = memorySink();
  vi.stubGlobal("__sidebandWebTelemetry", createTelemetry({ service: "web", sink, lifecycle: false }));
  handler.mockResolvedValueOnce(new Response(null, { status }));
  const request = new Request("https://sideband.test/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: "client_id=agenda" }),
  });

  const response = await POST(request);

  expect(response.status).toBe(status);
  expect(sink.find("auth.oauth.consent")).toHaveLength(events);
});
