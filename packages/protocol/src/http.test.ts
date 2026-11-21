import { expect, it } from "vitest";
import { httpStatusOf } from "./errors.js";
import { decodeAsk, encodeAsk, routes } from "./http.js";
import { AskInput } from "./request.js";

it.each(Object.values(routes))("$method $path has a schema and the designated issuer", (route) => {
  expect(route.response.safeParse).toBeTypeOf("function");
  const issuer = route.path.startsWith("/v1/agent/") ? "mcp" : route.path.startsWith("/v1/admin/") ? "admin" : "web";
  expect(route.iss).toBe(route.path === "/healthz" ? null : issuer);
});

it("uses an empty response schema for 204 routes", () => {
  for (const route of Object.values(routes)) {
    if ("status" in route && route.status === 204) {
      expect(route.response.safeParse(undefined).success).toBe(true);
      expect(route.response.safeParse({}).success).toBe(false);
    }
  }
});

it("validates the activity limit as a positive integer", () => {
  expect(routes.ownerActivity.query.parse({ limit: "5" })).toEqual({ limit: 5 });
  expect(routes.ownerActivity.query.safeParse({ limit: "0" }).success).toBe(false);
});

it("validates the vault visits limit as a bounded positive integer", () => {
  expect(routes.agentVaultVisits.query.parse({ limit: "5" })).toEqual({ limit: 5 });
  expect(routes.agentVaultVisits.query.safeParse({ limit: "0" }).success).toBe(false);
  expect(routes.ownerVaultVisits.query.safeParse({ limit: "201" }).success).toBe(false);
});

it("requires a reason of 10 to 500 characters on admin mutations", () => {
  const body = routes.adminExpire.body;
  expect(body.safeParse({ reason: "Atascada por un aviso caído" }).success).toBe(true);
  expect(body.safeParse({ reason: "corta" }).success).toBe(false);
  expect(body.safeParse({ reason: "          relleno  " }).success).toBe(false);
  expect(body.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  expect(body.safeParse({}).success).toBe(false);
  expect(routes.adminRevokeAgent.params.parse({ userId: "u1", agentId: "a1" })).toEqual({ userId: "u1", agentId: "a1" });
});

it("matches the HTTP error status contract", () => {
  expect(httpStatusOf("unauthorized")).toBe(401);
  expect(httpStatusOf("forbidden")).toBe(403);
  expect(httpStatusOf("not_found")).toBe(404);
  expect(httpStatusOf("invalid_input")).toBe(400);
  expect(httpStatusOf("conflict")).toBe(409);
  expect(httpStatusOf("expired")).toBe(410);
  expect(httpStatusOf("rate_limited")).toBe(429);
  expect(httpStatusOf("internal")).toBe(500);
});


it("preserves plain asks and requires a capable server to decode a conditional send", () => {
  const ask = AskInput.parse({ tool: "interest_check", to: "ana@sideband.app", args: { interest: "cerámica" } });
  expect(encodeAsk(ask)).toEqual(ask);
  const checked = { ...ask, idempotencyKey: "stable-message-123", requireRelation: { kind: "contact" as const, tag: "friend" as const } };
  for (const route of [routes.agentAsk, routes.ownerAsk, routes.ownerChannelAsk]) {
    const body = route.body.parse(encodeAsk(checked));
    expect(AskInput.safeParse(body).success).toBe(false);
    expect(decodeAsk(body)).toEqual(checked);
  }
});
