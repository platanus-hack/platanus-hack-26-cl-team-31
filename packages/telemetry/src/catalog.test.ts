import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog, describeCatalog, getEventDefinition } from "./catalog.js";
import { EventKind, Level, Service } from "./types.js";

const sql = readFileSync(new URL("../../ops/sql/0001_events.sql", import.meta.url), "utf8");

function checkValues(column: string): string[] {
  const match = new RegExp(`${column}\\s+text[^\\n]*CHECK \\(${column} IN \\(([^)]*)\\)`).exec(sql);
  if (!match) throw new Error(`No encontré el CHECK de ${column}`);
  return match[1]!.split(",").map((value) => value.trim().replace(/'/g, ""));
}

describe("catálogo", () => {
  it("usa los mismos enums que los CHECK de ops.events", () => {
    expect([...Service.options].sort()).toEqual(checkValues("service").sort());
    expect([...EventKind.options].sort()).toEqual(checkValues("kind").sort());
    expect([...Level.options].sort()).toEqual(checkValues("level").sort());
  });

  it("declara todos los eventos de docs/admin.md#3", () => {
    const expected = [
      "service.started", "service.heartbeat", "service.stopping",
      "http.request", "http.rate_limited",
      "auth.token.verified", "auth.token.rejected", "auth.service_jwt.rejected", "auth.oauth.consent", "auth.scope.denied",
      "mcp.tool.call", "broker.policy.evaluated", "broker.request.created", "broker.request.status_changed",
      "broker.request.closed", "broker.reply.rejected", "broker.owner.decided",
      "wake.attempt", "wake.exhausted", "coordination.tool.call", "demo.contact.seeded", "error",
      "admin.login", "admin.logout", "admin.reveal", "admin.action", "admin.token.created",
      "admin.token.revoked", "admin.mcp.call", "telemetry.invalid_event",
    ];
    expect(catalog.map((event) => event.name).sort()).toEqual(expected.sort());
    expect(new Set(catalog.map((event) => event.name)).size).toBe(catalog.length);
  });

  it("solo acepta escalares y descarta llaves no declaradas", () => {
    const definition = getEventDefinition("mcp.tool.call")!;
    expect(definition.attrs.parse({ tool: "ask", outcome: "ok", authorization: "Bearer x" })).toEqual({ tool: "ask", outcome: "ok" });
    expect(definition.attrs.safeParse({ outcome: "maybe" }).success).toBe(false);
    expect(getEventDefinition("http.request")!.attrs.safeParse({ route: "/v1/x?token=abc def" }).success).toBe(false);
  });

  it("se serializa para admin://schema", () => {
    const entry = describeCatalog().find((event) => event.name === "wake.attempt");
    expect(entry).toMatchObject({ kind: "wake", attrs: ["kind", "attempt", "ok", "httpStatus", "code"] });
    expect(JSON.parse(JSON.stringify(describeCatalog()))).toHaveLength(catalog.length);
  });
});
