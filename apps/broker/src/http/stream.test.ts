import type { OwnerPort } from "@team-31/broker";
import { routes } from "@team-31/protocol/http";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import type { AuthContext } from "./auth.js";
import { ownerStream } from "./stream.js";

it("registra el error de actividad cuando falla el sondeo de un stream abierto", async () => {
  const failure = new Error("Falló la lectura de actividad");
  const activity = vi.fn<OwnerPort["activity"]>().mockResolvedValueOnce([]).mockRejectedValue(failure);
  const telemetry = { error: vi.fn() };
  const route = routes.ownerStream;
  const app = new Hono<AuthContext>();
  app.get(route.path, (c) => {
    c.set("web", { userId: "bruno" });
    return ownerStream(c, { activity }, route.response, telemetry);
  });

  const response = await app.request(route.path);
  await response.text();
  expect(telemetry.error).toHaveBeenCalledExactlyOnceWith(`GET ${route.path}`, failure);
});
