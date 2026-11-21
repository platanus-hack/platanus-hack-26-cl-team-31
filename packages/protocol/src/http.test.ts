import { expect, it } from "vitest";
import { httpStatusOf } from "./errors.js";
import { routes } from "./http.js";

it.each(Object.values(routes))("$method $path has a schema and the designated issuer", (route) => {
  expect(route.response.safeParse).toBeTypeOf("function");
  const issuer = route.path.startsWith("/v1/agent/") ? "mcp" : "web";
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
