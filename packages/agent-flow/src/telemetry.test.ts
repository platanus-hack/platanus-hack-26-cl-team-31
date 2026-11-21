import { describe, expect, it } from "vitest";

import { BROKER, type FlowActor, type FlowEvent } from "./model.js";
import { scenarioEvents, scenarioRows } from "./scenario.js";
import { createFlowDirectory, createTelemetryMapper, type TelemetryRow } from "./telemetry.js";

const directory = () =>
  createFlowDirectory({
    users: [
      { userId: "u1", address: "ana@sideband.app", displayName: "Ana" },
      { userId: "u2", address: "bob@sideband.app", displayName: "Bob" },
    ],
    agents: [
      { agentId: "a1", userId: "u1", label: "Claude Code", kind: "mcp_events" },
      { agentId: "b1", userId: "u2", label: "WhatsApp", kind: "whatsapp" },
    ],
    requests: [{ id: "r1", fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app" }],
  });

let seq = 0;
const row = (name: string, fields: Partial<TelemetryRow> = {}): TelemetryRow => ({
  id: String(++seq),
  at: 1_000 + seq * 10,
  service: name.startsWith("mcp") ? "mcp" : name.startsWith("wake") ? "worker" : "broker",
  name,
  requestId: "r1",
  attrs: {},
  ...fields,
});

const actor = (endpoint: FlowEvent["from"]) => (endpoint === BROKER ? BROKER : (endpoint as FlowActor).id);
const steps = (events: FlowEvent[]) => events.map((e) => `${e.step}:${e.status}:${actor(e.from)}>${actor(e.to)}`);

describe("createTelemetryMapper", () => {
  it("draws an allowed request end to end with the agents of each side", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "availability", category: "availability", decision: "allow", rule: "grant" } }),
      row("broker.request.created", { userId: "u1", agentId: "a1", attrs: { tool: "availability", rule: "grant" } }),
      row("mcp.tool.call", { userId: "u1", agentId: "a1", durationMs: 30, attrs: { tool: "sideband_ask", outcome: "ok" } }),
      row("wake.attempt", { userId: "u2", agentId: "b1", durationMs: 5, attrs: { kind: "standard_webhook", attempt: 1, ok: true, httpStatus: 200 } }),
      row("broker.request.status_changed", { attrs: { from: "awaiting_agent", to: "answered", by: "agent" } }),
      row("mcp.tool.call", { userId: "u2", agentId: "b1", attrs: { tool: "sideband_reply", outcome: "ok" } }),
      row("broker.request.closed", { attrs: { outcome: "answered", escalated: false } }),
    ].flatMap((r) => mapper.map(r));

    expect(steps(events)).toEqual([
      "ask:pending:agent:a1>broker",
      "policy:allowed:broker>broker",
      "request:ok:broker>broker",
      "wake:ok:broker>agent:b1",
      "reply:ok:agent:b1>broker",
      "delivered:delivered:broker>agent:a1",
    ]);
    const ask = events[0]!.from as FlowActor;
    expect(ask).toMatchObject({ label: "Claude Code", channel: "MCP", owner: { key: "ana@sideband.app", label: "Ana" } });
    expect(events[1]!.meta).toMatchObject({ tool: "availability", category: "availability", decision: "allow", rule: "grant" });
    expect(events.every((e) => e.requestId === "r1")).toBe(true);
  });

  it("draws the ask from the MCP span when it arrives first and does not repeat it", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("mcp.tool.call", { userId: "u1", agentId: "a1", attrs: { tool: "sideband_ask", outcome: "ok" } }),
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "question", category: "health", decision: "deny", rule: "no_grant" } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual(["ask:pending:agent:a1>broker", "policy:denied:broker>broker"]);
  });

  it("closes a denied request with a signed denial and no wake", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "question", category: "health", decision: "deny", rule: "no_grant" } }),
      row("broker.request.closed", { attrs: { outcome: "denied", escalated: false } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual(["ask:pending:agent:a1>broker", "policy:denied:broker>broker", "delivered:denied:broker>agent:a1"]);
  });

  it("marks a leak_blocked reply as blocked with its codes and a sanitized reply with dropped fields", () => {
    const mapper = createTelemetryMapper(directory());
    mapper.map(row("wake.attempt", { userId: "u2", agentId: "b1", attrs: { ok: true, attempt: 1 } }));
    const [blocked] = mapper.map(row("broker.reply.rejected", { attrs: { code: "leak_blocked", flags: "leak-guard:leak_email,leak-guard:leak_phone" } }));
    const [sanitized] = mapper.map(row("broker.reply.sanitized", { attrs: { flags: "redact:redacted", dropped: "freeSlots,note" } }));
    expect(blocked).toMatchObject({ step: "reply_blocked", status: "blocked", meta: { code: "leak_blocked", flags: ["leak-guard:leak_email", "leak-guard:leak_phone"] } });
    expect(actor(blocked!.from)).toBe("agent:b1");
    expect(sanitized).toMatchObject({ step: "sanitized", status: "sanitized", meta: { flags: ["redact:redacted"], fieldsDropped: ["freeSlots", "note"] } });
  });

  it("escalates to the recipient's owner and shows the owner's decision", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.request.status_changed", { attrs: { from: "awaiting_agent", to: "awaiting_owner", by: "agent" } }),
      row("broker.owner.decided", { userId: "u2", attrs: { decision: "approve_once" } }),
      row("broker.request.status_changed", { attrs: { from: "awaiting_owner", to: "answered", by: "owner" } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual([
      "reply:ok:agent@bob@sideband.app>broker",
      "escalated:escalated:broker>owner@bob@sideband.app",
      "owner_decided:allowed:owner@bob@sideband.app>broker",
    ]);
  });

  it("starts spans at their beginning and keeps their latency", () => {
    const mapper = createTelemetryMapper(directory());
    const [wake] = mapper.map(row("wake.attempt", { at: 5_000, durationMs: 900, agentId: "b1", attrs: { ok: false, attempt: 1, httpStatus: 503 } }));
    expect(wake).toMatchObject({ at: 4_100, status: "failed", meta: { latencyMs: 900, httpStatus: 503, attempt: 1 } });
  });

  it("reads the demo MCP (coordination.tool.call) only for ask and check", () => {
    const mapper = createTelemetryMapper(directory());
    expect(mapper.map(row("coordination.tool.call", { requestId: "r9", userId: "u1", attrs: { tool: "ask_contact", outcome: "ok" } }))).toMatchObject([{ step: "ask" }]);
    expect(mapper.map(row("coordination.tool.call", { requestId: null, userId: "u1", attrs: { tool: "availability_check", outcome: "ok" } }))).toEqual([]);
  });

  it("ignores events outside the flow", () => {
    const mapper = createTelemetryMapper(directory());
    for (const name of ["http.request", "service.heartbeat", "auth.token.verified", "error", "broker.grant.set"]) {
      expect(mapper.map(row(name, { attrs: { route: "/v1/agent/ask", status: 200 } }))).toEqual([]);
    }
  });

  it("never copies attributes outside its allowlist", () => {
    const mapper = createTelemetryMapper(directory());
    const secret = "texto-secreto-de-un-tercero";
    const attrs = { args: secret, result: secret, text: secret, purpose: secret, nonce: secret, authorization: secret, token: secret };
    const events = [
      row("broker.policy.evaluated", { userId: "u1", attrs: { ...attrs, tool: "question", decision: "allow", rule: "grant" } }),
      row("wake.attempt", { attrs: { ...attrs, ok: true } }),
      row("broker.reply.rejected", { attrs: { ...attrs, code: "leak_blocked" } }),
      row("broker.request.status_changed", { attrs: { ...attrs, from: "awaiting_agent", to: "answered", by: "agent" } }),
      row("broker.request.closed", { attrs: { ...attrs, outcome: "answered" } }),
      row("mcp.tool.call", { attrs: { ...attrs, tool: "sideband_inbox", outcome: "ok" } }),
    ].flatMap((r) => mapper.map(r));
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("falls back to a placeholder agent when the directory does not know the request", () => {
    const mapper = createTelemetryMapper(createFlowDirectory());
    const [ask] = mapper.map(row("broker.policy.evaluated", { requestId: "zz", userId: "user-1234567890", attrs: { decision: "allow" } }));
    expect(ask!.from).toMatchObject({ id: "agent@user:user-1234567890", placeholder: true, owner: { label: "user-123…" } });
  });
});

describe("scenario", () => {
  it("maps every row through the same telemetry mapper and covers each status", () => {
    const events = scenarioEvents();
    expect(scenarioRows().length).toBeGreaterThan(20);
    const statuses = new Set(events.map((e) => e.status));
    for (const status of ["pending", "allowed", "denied", "blocked", "sanitized", "escalated", "delivered", "expired", "failed"] as const) {
      expect(statuses, status).toContain(status);
    }
    const owners = new Set(events.flatMap((e) => [e.from, e.to]).filter((e) => e !== BROKER).map((e) => (e as FlowActor).owner.label));
    expect([...owners].sort()).toEqual(["Ana", "Bob", "Carla", "Dani", "Fran", "Gabi", "Hugo", "Inés"]);
    // Orden estable por tiempo.
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
  });

  it("never wakes the recipient of a denied request", () => {
    const denied = scenarioEvents().filter((e) => e.requestId === "req-ana-carla");
    expect(denied.map((e) => e.step)).toEqual(["ask", "policy", "request", "delivered"]);
    expect(denied.at(-1)).toMatchObject({ status: "denied" });
  });
});

describe("presence mapping", () => {
  it("builds the initial network and maps WhatsApp links and first MCP calls", () => {
    const dir = createFlowDirectory({
      users: [
        { userId: "u1", address: "ana@sideband.app", displayName: "Ana" },
        { userId: "u3", address: "luz@sideband.app", displayName: "Luz" },
      ],
      agents: [
        { agentId: "a1", userId: "u1", label: "Claude Code", kind: "mcp_events" },
        { agentId: "old", userId: "u1", label: "Viejo", kind: "mcp_events", revokedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    const mapper = createTelemetryMapper(dir);
    const snapshot = mapper.snapshot(5);
    expect(snapshot.map((e) => `${e.step}:${actor(e.from)}`)).toEqual(["joined:agent:a1", "joined:agent@luz@sideband.app"]);
    expect(snapshot.every((e) => e.meta.snapshot)).toBe(true);
    // a1 ya estaba en la foto: su llamada no repite la entrada.
    expect(mapper.map(row("mcp.tool.call", { requestId: null, userId: "u1", agentId: "a1", attrs: { tool: "sideband_inbox", outcome: "ok" } })).map((e) => e.step)).toEqual(["inbox"]);
    dir.add({ users: [{ userId: "u4", address: "max@sideband.app", displayName: "Max" }] });
    expect(mapper.map(row("whatsapp.link", { requestId: null, userId: "u4", attrs: { action: "confirmed" } }))).toMatchObject([{ step: "joined", from: { id: "whatsapp@max@sideband.app", channel: "WhatsApp" } }]);
    expect(mapper.map(row("whatsapp.link", { requestId: null, userId: "u4", attrs: { action: "unlinked" } }))).toMatchObject([{ step: "left" }]);
    expect(mapper.map(row("whatsapp.link", { requestId: null, userId: "u4", attrs: { action: "started" } }))).toEqual([]);
  });
});
