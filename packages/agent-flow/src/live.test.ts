import { describe, expect, it } from "vitest";

import { compareIds, createLiveFeed, occurredAt } from "./live.js";
import { createFlowDirectory, createTelemetryMapper, type TelemetryRow } from "./telemetry.js";

const mapper = () =>
  createTelemetryMapper(
    createFlowDirectory({
      users: [{ userId: "u1", address: "ana@sideband.app" }, { userId: "u2", address: "bob@sideband.app" }],
      agents: [{ agentId: "a1", userId: "u1" }, { agentId: "b1", userId: "u2" }],
      requests: [{ id: "r1", fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app" }],
    }),
  );
const row = (id: string, name: string, at: number, fields: Partial<TelemetryRow> = {}): TelemetryRow => ({ id, at, service: "broker", name, requestId: "r1", attrs: {}, ...fields });

describe("createLiveFeed", () => {
  it("holds rows, then releases them in the order they happened", () => {
    const feed = createLiveFeed(mapper(), { holdMs: 500 });
    // El broker escribe su lote antes que el span del MCP que lo contiene y que el aviso.
    feed.push(row("12", "broker.request.closed", 1_300, { attrs: { outcome: "answered" } }), 0);
    feed.push(row("10", "broker.policy.evaluated", 1_000, { userId: "u1", agentId: "a1", attrs: { decision: "allow" } }), 0);
    feed.push(row("11", "wake.attempt", 1_200, { service: "worker", userId: "u2", agentId: "b1", durationMs: 100, attrs: { ok: true } }), 100);
    expect(feed.drain(400)).toEqual([]);
    const steps = feed.drain(700, true).map((e) => e.step);
    expect(steps).toEqual(["ask", "policy", "wake", "delivered"]);
    expect(feed.size).toBe(0);
  });

  it("releases earlier events with a due row even if older events keep arriving", () => {
    const feed = createLiveFeed(mapper(), { holdMs: 500 });
    feed.push(row("20", "broker.request.created", 2_000), 0);
    feed.push(row("19", "broker.policy.evaluated", 1_900, { attrs: { decision: "allow" } }), 400);
    expect(feed.drain(450)).toEqual([]);
    feed.push(row("18", "wake.attempt", 1_800, { attrs: { ok: true } }), 490);
    feed.push(row("21", "broker.request.closed", 2_100, { attrs: { outcome: "answered" } }), 495);
    expect(feed.drain(500).map((e) => e.step)).toEqual(["wake", "ask", "policy", "request"]);
    expect(feed.drain(995).map((e) => e.step)).toEqual(["delivered"]);
  });

  it("drops duplicates from reconnects", () => {
    const feed = createLiveFeed(mapper(), { holdMs: 0 });
    expect(feed.push(row("5", "broker.request.created", 1), 0)).toBe(true);
    expect(feed.push(row("5", "broker.request.created", 1), 1)).toBe(false);
    expect(feed.drain(10)).toHaveLength(1);
    expect(feed.push(row("5", "broker.request.created", 1), 20)).toBe(false);
  });

  it("orders by start for spans and compares bigint ids as numbers", () => {
    expect(occurredAt({ at: "2026-11-21T00:00:01.000Z", name: "mcp.tool.call", durationMs: 250 })).toBe(Date.parse("2026-11-21T00:00:00.750Z"));
    expect(occurredAt({ at: 1_000, name: "broker.request.closed", durationMs: 250 })).toBe(1_000);
    expect(compareIds("9", "10")).toBeLessThan(0);
    expect(compareIds("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
  });
});
